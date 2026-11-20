//! The download loops that run per connection.
//!
//! Each connection runs [`run_segment`] on one segment of the live [`SegmentTable`]: request the
//! missing byte range, claim bytes from the segment, write them into the shared pre-allocated file
//! at the right offset, and on trouble back off and reconnect, resuming from the first byte not yet
//! written. Servers without range support get one connection that restarts from byte 0.
//!
//! Sources: a download may have several verified **mirrors** of the same file. Every (re)connection
//! picks the least busy, healthiest source, so segments are fetched from different mirrors at the
//! same time, and a mirror that keeps failing is benched while the others carry on.
//!
//! Transport: when a source advertises HTTP/3, the first attempt uses QUIC with a short handshake
//! timeout; if QUIC fails before any answer arrives (UDP blocked, handshake trouble) the very same
//! attempt is repeated over TCP immediately and that origin sticks to TCP from then on.
//!
//! Retry rules (Phase 2):
//! * network errors (reset, timeout, DNS, early close): retried **forever**, exponential backoff
//!   with jitter 1 s, 2 s, 4 s ... capped at 60 s; sleepers wake immediately when the network
//!   returns;
//! * 408 / 425 / 429 / 5xx: limited retries, honouring `Retry-After`;
//! * other 4xx: very few retries;
//! * 403 / 410: the link has probably expired: reported to the manager, which refreshes it.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicU8, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::header::{CONTENT_RANGE, IF_RANGE, RANGE, RETRY_AFTER};
use reqwest::{Client, Method};
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;
use url::Url;

use crate::error::{EngineError, RetryClass};
use crate::http::{protocol_label, send_with_auth, HttpSession, H3_HEADER_TIMEOUT, HEADER_TIMEOUT};
use crate::limiter::RateLimiter;
use crate::netwatch::{FailLog, NetState};
use crate::probe::parse_content_range_start;
use crate::table::{SegState, SegmentTable};
use crate::writer::OffsetFile;

/// Network data is collected in memory and written to disk in blocks of at least this size ...
const FLUSH_SIZE: usize = 256 * 1024;
/// ... or after this long, so progress stays smooth on slow connections.
const FLUSH_INTERVAL: Duration = Duration::from_millis(200);

/// A source that failed this many times in a row is left alone for a while.
const BENCH_AFTER_FAILURES: u32 = 3;
const BENCH_FOR_MS: u64 = 30_000;

#[derive(Debug, Clone, Copy)]
pub struct RetryPolicy {
    /// Retries for 408 / 425 / 429 / 5xx before giving up.
    pub max_server_retries: u32,
    /// Retries for other 4xx before giving up.
    pub max_client_retries: u32,
    /// Retries of the initial probe (network and server errors only).
    pub max_probe_retries: u32,
    pub base_delay: Duration,
    /// Backoff cap (60 s). Network errors have no retry limit, only this cap.
    pub max_delay: Duration,
    /// Backstop: a connection that delivers nothing for this long is dropped. (The faster,
    /// configurable stall detection lives in the monitor loop.)
    pub stall_timeout: Duration,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_server_retries: 10,
            max_client_retries: 3,
            max_probe_retries: 4,
            base_delay: Duration::from_secs(1),
            max_delay: Duration::from_secs(60),
            stall_timeout: Duration::from_secs(30),
        }
    }
}

impl RetryPolicy {
    /// Exponential backoff with +/-20 % jitter: 1 s, 2 s, 4 s, ... never above `max_delay`.
    pub fn delay(&self, failures: u32) -> Duration {
        let exp = failures.saturating_sub(1).min(16);
        let d = self.base_delay.saturating_mul(1u32 << exp).min(self.max_delay);
        let jitter = 0.8 + 0.4 * rand::random::<f64>();
        d.mul_f64(jitter).min(self.max_delay)
    }

    /// Delay before reconnecting a connection that **was delivering data** when it dropped (an
    /// eighth of the base delay, 125 ms by default). It worked a moment ago, so waiting a full second
    /// would only waste time on a flaky link; real backoff applies if attempts then keep failing.
    pub fn quick_delay(&self) -> Duration {
        let jitter = 0.8 + 0.4 * rand::random::<f64>();
        (self.base_delay / 8).mul_f64(jitter)
    }
}

// ---- sources (primary + mirrors) ---------------------------------------------------------------

/// One place the file can be fetched from.
pub struct Source {
    pub url: Url,
    pub session: Arc<HttpSession>,
    /// Connections currently using this source.
    active: AtomicUsize,
    /// Consecutive failed attempts.
    fails: AtomicU32,
    /// Do not use before this table time (ms), after repeated failures.
    benched_until_ms: AtomicU64,
}

/// Releases a source's connection slot when dropped.
pub struct SourceGuard<'a>(&'a Source);

impl Drop for SourceGuard<'_> {
    fn drop(&mut self) {
        self.0.active.fetch_sub(1, Ordering::SeqCst);
    }
}

/// The primary link (index 0) plus verified mirrors.
pub struct SourceSet {
    pub sources: Vec<Source>,
}

impl SourceSet {
    pub fn new(list: Vec<(Url, Arc<HttpSession>)>) -> Self {
        let sources = list
            .into_iter()
            .map(|(url, session)| Source {
                url,
                session,
                active: AtomicUsize::new(0),
                fails: AtomicU32::new(0),
                benched_until_ms: AtomicU64::new(0),
            })
            .collect();
        Self { sources }
    }

    pub fn len(&self) -> usize {
        self.sources.len()
    }

    pub fn is_empty(&self) -> bool {
        self.sources.is_empty()
    }

    /// Choose where the next connection goes: skip benched sources (unless all are benched), then
    /// prefer the one with the fewest connections, then the one that has failed least, then the
    /// primary. This spreads connections evenly, and so different segments are fetched from
    /// different mirrors at the same time.
    pub fn acquire(&self, now_ms: u64) -> (usize, SourceGuard<'_>) {
        let key = |s: &Source| {
            (
                s.benched_until_ms.load(Ordering::SeqCst) > now_ms,
                s.active.load(Ordering::SeqCst),
                s.fails.load(Ordering::SeqCst),
            )
        };
        let idx = (0..self.sources.len()).min_by_key(|&i| (key(&self.sources[i]), i)).unwrap_or(0);
        self.sources[idx].active.fetch_add(1, Ordering::SeqCst);
        (idx, SourceGuard(&self.sources[idx]))
    }

    /// An attempt on this source failed (network / server error).
    pub fn note_failure(&self, idx: usize, now_ms: u64) {
        let s = &self.sources[idx];
        if s.fails.fetch_add(1, Ordering::SeqCst) + 1 >= BENCH_AFTER_FAILURES {
            s.benched_until_ms.store(now_ms + BENCH_FOR_MS, Ordering::SeqCst);
        }
    }

    /// An attempt on this source delivered data.
    pub fn note_success(&self, idx: usize) {
        let s = &self.sources[idx];
        s.fails.store(0, Ordering::SeqCst);
        s.benched_until_ms.store(0, Ordering::SeqCst);
    }
}

#[derive(Clone)]
pub struct WorkerCtx {
    pub sources: Arc<SourceSet>,
    pub file: OffsetFile,
    /// Value for `If-Range`, so a changed file is detected instead of silently mixed in.
    pub validator: Option<String>,
    pub global_limiter: Arc<RateLimiter>,
    pub dl_limiter: Arc<RateLimiter>,
    pub cancel: CancellationToken,
    pub table: Arc<SegmentTable>,
    /// Number of connections currently waiting to reconnect (shown as a note in the UI).
    pub retrying: Arc<AtomicU32>,
    pub retry: RetryPolicy,
    pub net: Arc<NetState>,
    pub fails: Arc<FailLog>,
    /// Wire protocol of the latest response (see [`protocol_code`]).
    pub protocol: Arc<AtomicU8>,
}

/// Compact protocol code kept in an atomic: 0 unknown, 1 HTTP/1.1, 2 HTTP/2, 3 HTTP/3.
pub fn protocol_code(v: reqwest::Version) -> u8 {
    match protocol_label(v) {
        "HTTP/3" => 3,
        "HTTP/2" => 2,
        _ => 1,
    }
}

pub fn protocol_name(code: u8) -> Option<&'static str> {
    match code {
        1 => Some("HTTP/1.1"),
        2 => Some("HTTP/2"),
        3 => Some("HTTP/3"),
        _ => None,
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum WorkerExit {
    /// The segment is fully downloaded.
    Finished,
    /// Paused or cancelled by the user; buffered data has been written.
    Stopped,
    /// The monitor closed this connection (stall, or the connection count was reduced). The
    /// segment keeps its progress and will be picked up again.
    Aborted,
}

/// Download one segment, retrying and resuming as needed.
pub async fn run_segment(ctx: WorkerCtx, seg: Arc<SegState>) -> Result<WorkerExit, EngineError> {
    let result = segment_loop(&ctx, &seg).await;
    if matches!(result, Ok(WorkerExit::Finished)) {
        seg.mark_finished();
    }
    seg.set_running(false);
    result
}

fn exit_for_cancel(ctx: &WorkerCtx) -> WorkerExit {
    if ctx.cancel.is_cancelled() {
        WorkerExit::Stopped
    } else {
        WorkerExit::Aborted
    }
}

/// Clients of one worker, built on first use. A fresh client means a fresh TCP/QUIC connection.
#[derive(Default)]
struct Clients {
    tcp: HashMap<usize, Client>,
    h3: HashMap<usize, Client>,
}

impl Clients {
    fn tcp(&mut self, idx: usize, s: &HttpSession) -> Result<Client, EngineError> {
        if let Some(c) = self.tcp.get(&idx) {
            return Ok(c.clone());
        }
        let c = s.client()?;
        self.tcp.insert(idx, c.clone());
        Ok(c)
    }

    fn h3(&mut self, idx: usize, s: &HttpSession) -> Result<Client, EngineError> {
        if let Some(c) = self.h3.get(&idx) {
            return Ok(c.clone());
        }
        let c = s.client_h3()?;
        self.h3.insert(idx, c.clone());
        Ok(c)
    }
}

async fn segment_loop(ctx: &WorkerCtx, seg: &Arc<SegState>) -> Result<WorkerExit, EngineError> {
    let mut clients = Clients::default();
    let (mut net_fail, mut server_fail, mut client_fail) = (0u32, 0u32, 0u32);
    loop {
        if ctx.cancel.is_cancelled() {
            return Ok(WorkerExit::Stopped);
        }
        let ranged = ctx.table.ranged;
        let Some((offset, token)) = seg.begin_attempt(&ctx.cancel, !ranged, ctx.table.now_ms()) else {
            return Ok(WorkerExit::Finished);
        };
        let written_before = seg.written();

        // Where does this connection go, and over which transport?
        let (idx, _slot) = ctx.sources.acquire(ctx.table.now_ms());
        let src = &ctx.sources.sources[idx];
        let mut use_h3 = src.session.h3_usable(&src.url);
        let client = if use_h3 {
            match clients.h3(idx, &src.session) {
                Ok(c) => c,
                Err(_) => {
                    src.session.h3_failed(); // cannot even build a QUIC client: TCP it is
                    use_h3 = false;
                    clients.tcp(idx, &src.session)?
                }
            }
        } else {
            clients.tcp(idx, &src.session)?
        };

        // `answered` flips once the server has sent response headers; a failure before that on
        // HTTP/3 means QUIC itself does not work here.
        let answered = AtomicBool::new(false);
        let result = if ranged {
            fetch_range(ctx, src, &client, seg, offset, &token, use_h3, &answered).await
        } else {
            fetch_all(ctx, src, &client, seg, &token, use_h3, &answered).await
        };
        let err = match result {
            Ok(()) => {
                ctx.sources.note_success(idx);
                return Ok(WorkerExit::Finished);
            }
            Err(EngineError::Stopped) => {
                if use_h3 && !answered.load(Ordering::SeqCst) && !ctx.cancel.is_cancelled() {
                    // The monitor cut this connection (stall detection) while QUIC had still not
                    // produced any answer. Its handshake timeout is longer than the stall limit, so
                    // without this a silent QUIC path (UDP blocked) would be retried forever. Treat
                    // it as QUIC failing and carry on over TCP right away.
                    src.session.h3_failed();
                    continue;
                }
                return Ok(exit_for_cancel(ctx));
            }
            Err(e) => e,
        };

        if use_h3 && !answered.load(Ordering::SeqCst) {
            // QUIC failed before any answer: switch this origin to TCP and retry right away,
            // without counting a failure or backing off.
            src.session.h3_failed();
            continue;
        }

        let progressed = seg.written() > written_before;
        if progressed {
            // We made progress, so this is a fresh problem, not a continuing one.
            (net_fail, server_fail, client_fail) = (0, 0, 0);
            ctx.sources.note_success(idx);
        }
        let delay = match err.retry_class() {
            RetryClass::Network => {
                net_fail += 1;
                // Only a connection that failed WITHOUT delivering anything counts towards "the
                // server keeps refusing us" (which halves the connection count). One that delivered
                // data and then dropped is just a flaky link: cutting parallelism would only slow
                // the download down.
                if !progressed {
                    ctx.fails.record();
                }
                ctx.sources.note_failure(idx, ctx.table.now_ms());
                if net_fail >= 2 {
                    // Repeated failures: is the whole internet down? Let the monitor find out.
                    ctx.net.request_check();
                }
                if progressed {
                    ctx.retry.quick_delay() // a working connection dropped: reconnect almost at once
                } else {
                    ctx.retry.delay(net_fail)
                }
            }
            RetryClass::Server => {
                server_fail += 1;
                ctx.sources.note_failure(idx, ctx.table.now_ms());
                if server_fail > ctx.retry.max_server_retries {
                    return Err(err);
                }
                let hint = Duration::from_millis(seg.take_retry_after_ms()).min(ctx.retry.max_delay);
                ctx.retry.delay(server_fail).max(hint)
            }
            RetryClass::Client => {
                client_fail += 1;
                if client_fail > ctx.retry.max_client_retries {
                    return Err(err);
                }
                ctx.retry.delay(client_fail)
            }
            RetryClass::Fatal => return Err(err),
        };
        drop(_slot); // do not hold the source's slot while sleeping

        // Back off. Deliberate idling is not a stall, and the wait ends early if the network
        // comes back or the connection is closed by the monitor / user.
        seg.begin_idle();
        ctx.retrying.fetch_add(1, Ordering::SeqCst);
        let cancelled = tokio::select! {
            _ = token.cancelled() => true,
            _ = ctx.net.sleep_until_up(delay) => false,
        };
        ctx.retrying.fetch_sub(1, Ordering::SeqCst);
        seg.end_idle(ctx.table.now_ms());
        if cancelled {
            return Ok(exit_for_cancel(ctx));
        }
    }
}

/// Map an error status to an error, remembering `Retry-After` for the caller.
fn status_error(seg: &SegState, resp: &reqwest::Response) -> EngineError {
    let s = resp.status().as_u16();
    match s {
        401 | 407 => EngineError::AuthFailed,
        403 | 410 => EngineError::LinkExpired,
        416 => EngineError::FileChanged,
        _ => {
            if let Some(secs) = resp
                .headers()
                .get(RETRY_AFTER)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.trim().parse::<u64>().ok())
            {
                seg.set_retry_after_ms(secs.saturating_mul(1000));
            }
            EngineError::Http(s)
        }
    }
}

/// reqwest sends a request over HTTP/3 only if the *request* is marked as HTTP/3; building the
/// client with `http3_prior_knowledge()` merely enables the QUIC connector.
fn h3_version(rb: reqwest::RequestBuilder, use_h3: bool) -> reqwest::RequestBuilder {
    if use_h3 {
        rb.version(reqwest::Version::HTTP_3)
    } else {
        rb
    }
}

/// Note which protocol the answer used, and that this transport works.
fn note_response(ctx: &WorkerCtx, src: &Source, resp: &reqwest::Response, use_h3: bool, answered: &AtomicBool) {
    answered.store(true, Ordering::SeqCst);
    ctx.protocol.store(protocol_code(resp.version()), Ordering::SeqCst);
    if use_h3 && resp.version() == reqwest::Version::HTTP_3 {
        src.session.h3_succeeded();
    }
}

#[allow(clippy::too_many_arguments)]
async fn fetch_range(
    ctx: &WorkerCtx,
    src: &Source,
    client: &Client,
    seg: &Arc<SegState>,
    offset: u64,
    token: &CancellationToken,
    use_h3: bool,
    answered: &AtomicBool,
) -> Result<(), EngineError> {
    let range = format!("bytes={}-{}", offset, seg.end());
    let timeout = if use_h3 { H3_HEADER_TIMEOUT } else { HEADER_TIMEOUT };
    let resp = send_with_auth(&src.session, client, Method::GET, &src.url, Some(token), timeout, |rb| {
        let rb = h3_version(rb, use_h3).header(RANGE, range.as_str());
        match &ctx.validator {
            Some(v) => rb.header(IF_RANGE, v.as_str()),
            None => rb,
        }
    })
    .await?;
    note_response(ctx, src, &resp, use_h3, answered);

    match resp.status().as_u16() {
        206 => {
            // The server must start exactly where we asked, or we'd write bytes to the wrong place.
            let got = resp
                .headers()
                .get(CONTENT_RANGE)
                .and_then(|v| v.to_str().ok())
                .and_then(parse_content_range_start);
            if got != Some(offset) {
                return Err(EngineError::Other("the server sent a different part of the file than requested".into()));
            }
        }
        // Full body instead of a range: the file changed (If-Range mismatch) or ranges stopped working.
        200 => {
            return Err(if ctx.validator.is_some() { EngineError::FileChanged } else { EngineError::RangeIgnored });
        }
        _ => return Err(status_error(seg, &resp)),
    }
    stream_body(ctx, seg, token, offset, resp).await
}

/// Single connection for servers that cannot resume. Any interruption restarts from byte 0.
async fn fetch_all(
    ctx: &WorkerCtx,
    src: &Source,
    client: &Client,
    seg: &Arc<SegState>,
    token: &CancellationToken,
    use_h3: bool,
    answered: &AtomicBool,
) -> Result<(), EngineError> {
    let timeout = if use_h3 { H3_HEADER_TIMEOUT } else { HEADER_TIMEOUT };
    let resp =
        send_with_auth(&src.session, client, Method::GET, &src.url, Some(token), timeout, |rb| h3_version(rb, use_h3))
            .await?;
    note_response(ctx, src, &resp, use_h3, answered);
    if !resp.status().is_success() {
        return Err(status_error(seg, &resp));
    }
    stream_body(ctx, seg, token, 0, resp).await
}

/// Write the response body into the file, claiming bytes from the segment as they arrive.
/// Returns `Ok(())` when the segment's range is complete (which may be sooner than the server's
/// response if part of the segment was stolen meanwhile).
async fn stream_body(
    ctx: &WorkerCtx,
    seg: &Arc<SegState>,
    token: &CancellationToken,
    mut offset: u64,
    resp: reqwest::Response,
) -> Result<(), EngineError> {
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::with_capacity(FLUSH_SIZE + 64 * 1024);
    let mut buf_start = offset;
    let mut last_flush = Instant::now();

    loop {
        let next = tokio::select! {
            _ = token.cancelled() => {
                flush(ctx, seg, &mut buf, &mut buf_start).await?;
                return Err(EngineError::Stopped);
            }
            r = tokio::time::timeout(ctx.retry.stall_timeout, stream.next()) => r,
        };

        match next {
            Err(_) => {
                flush(ctx, seg, &mut buf, &mut buf_start).await?;
                return Err(EngineError::Network("the connection stalled".into()));
            }
            Ok(Some(Err(e))) => {
                flush(ctx, seg, &mut buf, &mut buf_start).await?;
                return Err(e.into());
            }
            Ok(None) => {
                flush(ctx, seg, &mut buf, &mut buf_start).await?;
                let limit = seg.limit();
                return if limit == u64::MAX || offset >= limit {
                    Ok(())
                } else {
                    Err(EngineError::Network("the connection closed before the download finished".into()))
                };
            }
            Ok(Some(Ok(chunk))) => {
                seg.note_rx(chunk.len() as u64, ctx.table.now_ms());
                // Claim first: this fixes which bytes are ours even if a steal happens right now.
                let (_, n) = seg.claim(chunk.len() as u64);
                let n = n as usize;
                if n > 0 {
                    // Speed limits: global first, then per-download. Interruptible; waiting for
                    // the limiter is deliberate idling, not a stall.
                    seg.begin_idle();
                    let allowed = tokio::select! {
                        _ = token.cancelled() => false,
                        _ = async {
                            ctx.global_limiter.acquire(n as u64).await;
                            ctx.dl_limiter.acquire(n as u64).await;
                        } => true,
                    };
                    seg.end_idle(ctx.table.now_ms());
                    if !allowed {
                        flush(ctx, seg, &mut buf, &mut buf_start).await?;
                        return Err(EngineError::Stopped);
                    }
                    buf.extend_from_slice(&chunk[..n]);
                    offset += n as u64;
                }
                let reached_end = n < chunk.len() || offset >= seg.limit();
                if reached_end || buf.len() >= FLUSH_SIZE || last_flush.elapsed() >= FLUSH_INTERVAL {
                    flush(ctx, seg, &mut buf, &mut buf_start).await?;
                    last_flush = Instant::now();
                }
                if reached_end {
                    return Ok(());
                }
            }
        }
    }
}

/// Write the buffer to the file at `buf_start`, then advance the segment's written counter.
async fn flush(ctx: &WorkerCtx, seg: &SegState, buf: &mut Vec<u8>, buf_start: &mut u64) -> Result<(), EngineError> {
    if buf.is_empty() {
        return Ok(());
    }
    let data = std::mem::replace(buf, Vec::with_capacity(FLUSH_SIZE + 64 * 1024));
    let n = data.len() as u64;
    let at = *buf_start;
    let file = ctx.file.clone();
    // While the disk writes (which can take a long time on a slow or busy disk) this connection
    // is not reading, but it is not stalled either: the stall detector must not count the time.
    seg.begin_idle();
    // Disk writes are blocking calls: keep them off the async threads (rule 4).
    let written = tokio::task::spawn_blocking(move || file.write_all_at(at, &data)).await;
    seg.end_idle(ctx.table.now_ms());
    written.map_err(|e| EngineError::Other(format!("disk writer crashed: {e}")))??;
    seg.add_written(n);
    *buf_start += n;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::http::HttpOptions;

    fn policy() -> RetryPolicy {
        RetryPolicy::default()
    }

    #[test]
    fn backoff_follows_the_documented_schedule_and_caps_at_60s() {
        let p = policy();
        let d = |n| p.delay(n).as_secs_f64();
        // 1 s, 2 s, 4 s, 8 s ... with +/-20 % jitter.
        assert!((0.8..=1.2).contains(&d(1)), "{}", d(1));
        assert!((1.6..=2.4).contains(&d(2)));
        assert!((3.2..=4.8).contains(&d(3)));
        assert!((6.4..=9.6).contains(&d(4)));
        assert!((12.8..=19.2).contains(&d(5)));
        assert!((25.6..=38.4).contains(&d(6)));
        // From the 7th failure on it sits at the 60 s cap (jittered downwards, never above).
        for n in [7, 8, 20, 1000] {
            let v = d(n);
            assert!(v <= 60.0 && v >= 48.0, "failure {n}: {v}");
        }
    }

    #[test]
    fn a_connection_that_was_working_reconnects_in_a_fraction_of_a_second() {
        let p = policy();
        for _ in 0..50 {
            let d = p.quick_delay().as_secs_f64();
            assert!((0.09..=0.16).contains(&d), "{d}");
        }
        // ... and it is always much shorter than the first real backoff step.
        assert!(p.quick_delay() < p.base_delay / 4);
    }

    #[test]
    fn backoff_has_jitter() {
        let p = policy();
        let samples: Vec<u128> = (0..50).map(|_| p.delay(4).as_millis()).collect();
        let distinct: std::collections::HashSet<_> = samples.iter().collect();
        assert!(distinct.len() > 10, "delays should vary, got {} distinct values", distinct.len());
    }

    #[test]
    fn default_limits_match_the_spec() {
        let p = policy();
        assert_eq!(p.max_delay, Duration::from_secs(60));
        assert_eq!(p.base_delay, Duration::from_secs(1));
        assert!(p.max_client_retries > 0 && p.max_client_retries < p.max_server_retries);
    }

    fn sources(n: usize) -> SourceSet {
        SourceSet::new(
            (0..n)
                .map(|i| {
                    let url = Url::parse(&format!("http://mirror{i}.example/f.bin")).unwrap();
                    let session = Arc::new(HttpSession::new(&HttpOptions::default(), &url));
                    (url, session)
                })
                .collect(),
        )
    }

    #[test]
    fn connections_are_spread_evenly_over_the_sources() {
        let set = sources(3);
        // Nine connections held at once: three on each source, never lopsided.
        let guards: Vec<_> = (0..9).map(|_| set.acquire(0)).collect();
        let mut per = [0usize; 3];
        for (i, _) in &guards {
            per[*i] += 1;
        }
        assert_eq!(per, [3, 3, 3]);
        // Ties go to the primary.
        drop(guards);
        assert_eq!(set.acquire(0).0, 0);
    }

    #[test]
    fn a_released_slot_is_reused_first() {
        let set = sources(2);
        let (a, ga) = set.acquire(0);
        let (b, _gb) = set.acquire(0);
        assert_eq!((a, b), (0, 1));
        drop(ga);
        assert_eq!(set.acquire(0).0, 0, "the freed source is the least busy again");
    }

    #[test]
    fn a_failing_source_is_benched_and_forgiven_after_success() {
        let set = sources(2);
        for _ in 0..BENCH_AFTER_FAILURES {
            set.note_failure(0, 1_000);
        }
        // While benched, the healthy mirror gets every connection even though it is busier.
        let held: Vec<_> = (0..4).map(|_| set.acquire(2_000)).collect();
        assert!(held.iter().all(|(i, _)| *i == 1), "benched source was used");
        drop(held);
        // The bench expires, but source 0 still has the worse failure record, so the healthy
        // mirror is preferred until source 0 proves itself again.
        assert_eq!(set.acquire(1_000 + BENCH_FOR_MS + 1).0, 1);
        // A success forgives it completely (ties then go to the primary).
        set.note_success(0);
        assert_eq!(set.acquire(2_000).0, 0);
    }

    #[test]
    fn when_every_source_is_benched_the_least_busy_one_is_still_used() {
        let set = sources(2);
        for i in 0..2 {
            for _ in 0..BENCH_AFTER_FAILURES {
                set.note_failure(i, 0);
            }
        }
        let (a, _ga) = set.acquire(1);
        let (b, _gb) = set.acquire(1);
        assert_ne!(a, b, "still balanced");
    }

    #[test]
    fn protocol_codes_round_trip() {
        assert_eq!(protocol_name(protocol_code(reqwest::Version::HTTP_3)), Some("HTTP/3"));
        assert_eq!(protocol_name(protocol_code(reqwest::Version::HTTP_2)), Some("HTTP/2"));
        assert_eq!(protocol_name(protocol_code(reqwest::Version::HTTP_11)), Some("HTTP/1.1"));
        assert_eq!(protocol_name(0), None);
    }
}
