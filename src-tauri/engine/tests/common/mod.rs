//! A tiny HTTP/1.1 test server used by the integration tests and by the manual acceptance test
//! (`cargo run --release -p flowget-engine --example testserver`).
//!
//! The "file" it serves is *generated* from a seed: any byte range can be produced on demand and
//! the expected SHA-256 can be computed without storing anything. That means a 1 GB test file
//! costs no disk space on the server side.
//!
//! Features: HEAD (can be disabled), Range / If-Range / 206 / 416, ETag, Content-Disposition,
//! chunked (unknown length) bodies, per-connection speed limit, dropping the connection after N
//! bytes (to simulate an unstable network), redirects, Basic and Digest auth, and request logging.

#![allow(dead_code)]

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine as _;
use md5::{Digest as _, Md5};
use sha2::Sha256;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

#[derive(Clone, Debug)]
pub enum AuthMode {
    None,
    Basic { user: String, pass: String },
    Digest { user: String, pass: String },
}

/// Misbehaviour aimed at a request whose `Range` starts exactly at `start` (so a reconnect, which
/// asks for a different start, or a stolen half, is unaffected).
#[derive(Clone, Debug)]
pub struct Trouble {
    pub start: u64,
    pub kind: TroubleKind,
    /// Only the first matching request misbehaves.
    pub once: bool,
}

#[derive(Clone, Debug)]
pub enum TroubleKind {
    /// Serve this connection at only this many bytes per second.
    Slow(u64),
    /// Send this many bytes, then go silent but keep the connection open.
    StallAfter(u64),
}

#[derive(Clone, Debug)]
pub struct ServerConfig {
    pub size: u64,
    /// Different seeds produce different content ("the file changed").
    pub seed: u64,
    pub ranges: bool,
    pub head: bool,
    /// Send the body with `Transfer-Encoding: chunked` and no Content-Length.
    pub chunked: bool,
    pub etag: Option<String>,
    /// Bytes per second per connection; 0 = unlimited.
    pub rate_per_conn: u64,
    /// Close the connection after this many body bytes of each response.
    pub max_bytes_per_response: Option<u64>,
    pub file_name: Option<String>,
    pub auth: AuthMode,
    /// Per-connection misbehaviour, see [`Trouble`].
    pub trouble: Vec<Trouble>,
    /// Drop (close without answering) GET requests while this many transfers are already running.
    pub max_concurrent: Option<usize>,
    /// Answer every GET with this status (HEAD still works).
    pub fail_status: Option<u16>,
    /// Send `Retry-After: N` with `fail_status`.
    pub retry_after: Option<u64>,
    /// `/file.bin` demands `?token=N` with `N >= min_valid_token` (simulates signed links).
    pub require_token: bool,
    pub min_valid_token: u64,
    /// `/link` answers 403 (the "download page" itself is gone).
    pub link_dead: bool,
    /// Send this `Alt-Svc` header value (e.g. `h3=":443"; ma=60`).
    pub alt_svc: Option<String>,
    /// Answer GETs beyond `max_concurrent` with this status (e.g. 503) instead of silently dropping them.
    pub busy_status: Option<u16>,
    /// Simulated packet loss: the chance that any 16 KiB block of a response is "lost" (0.0 - 1.0).
    /// TCP hides loss as retransmission, so a lost block costs `loss_delay_ms` before it arrives;
    /// `loss_reset_share` of the lost blocks are worse (the retransmission timer gives up) and
    /// reset the connection.
    pub loss: f64,
    pub loss_delay_ms: u64,
    pub loss_reset_share: f64,
    /// Chance per 16 KiB block of an abrupt random disconnect (independent of `loss`).
    pub random_disconnect: f64,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            size: 1024 * 1024,
            seed: 1,
            ranges: true,
            head: true,
            chunked: false,
            etag: Some("\"v1\"".to_string()),
            rate_per_conn: 0,
            max_bytes_per_response: None,
            file_name: None,
            auth: AuthMode::None,
            trouble: Vec::new(),
            max_concurrent: None,
            fail_status: None,
            retry_after: None,
            require_token: false,
            min_valid_token: 0,
            link_dead: false,
            alt_svc: None,
            busy_status: None,
            loss: 0.0,
            loss_delay_ms: 120,
            loss_reset_share: 0.0,
            random_disconnect: 0.0,
        }
    }
}

#[derive(Default)]
pub struct Stats {
    pub requests: AtomicU64,
    pub get_requests: AtomicU64,
    /// GETs without a `Range` header: whole-file downloads (the engine's probe only sends ranged GETs).
    pub full_gets: AtomicU64,
    pub ranged_requests: AtomicU64,
    pub bytes_sent: AtomicU64,
    active: AtomicUsize,
    /// Highest number of simultaneously open body transfers.
    pub peak_connections: AtomicUsize,
    /// Headers (lower-case names) of every request received, in order.
    pub headers: Mutex<Vec<HashMap<String, String>>>,
    /// `Range` start of every ranged GET, in order.
    pub range_starts: Mutex<Vec<u64>>,
    /// Simulated internet outage: new connections are dropped and running transfers are cut.
    pub offline: std::sync::atomic::AtomicBool,
    /// Next signed-link token to hand out from `/link`.
    pub issued: AtomicU64,
    /// Requests refused with 403 because of an expired token / dead link.
    pub forbidden: AtomicU64,
    /// Connections dropped because of `max_concurrent`.
    pub refused: AtomicU64,
    /// Remote address of every accepted connection, in order (shows which local adapter a client used).
    pub peers: Mutex<Vec<std::net::IpAddr>>,
    triggered: Mutex<std::collections::HashSet<usize>>,
}

pub struct TestServer {
    pub addr: SocketAddr,
    pub cfg: Arc<Mutex<ServerConfig>>,
    pub stats: Arc<Stats>,
}

impl TestServer {
    pub fn url(&self) -> String {
        format!("http://{}/file.bin", self.addr)
    }
    pub fn url_path(&self, path: &str) -> String {
        format!("http://{}{}", self.addr, path)
    }
    pub fn update(&self, f: impl FnOnce(&mut ServerConfig)) {
        f(&mut self.cfg.lock().unwrap());
    }
    /// Simulate the internet going away / coming back.
    pub fn set_offline(&self, offline: bool) {
        self.stats.offline.store(offline, Ordering::SeqCst);
    }
    /// Make every signed link handed out so far invalid (new `/link` requests get fresh ones).
    pub fn expire_links(&self) {
        let now = self.stats.issued.load(Ordering::SeqCst);
        self.update(|c| c.min_valid_token = now);
    }
    pub fn expected_sha256(&self) -> String {
        let c = self.cfg.lock().unwrap();
        sha256_hex_of_generated(c.seed, c.size)
    }
}

/// Start the server on `bind` (use `127.0.0.1:0` for a free port).
pub async fn spawn(cfg: ServerConfig, bind: &str) -> TestServer {
    let listener = TcpListener::bind(bind).await.expect("bind test server");
    let addr = listener.local_addr().unwrap();
    let cfg = Arc::new(Mutex::new(cfg));
    let stats = Arc::new(Stats::default());
    let (c, s) = (cfg.clone(), stats.clone());
    tokio::spawn(async move {
        loop {
            let Ok((sock, peer)) = listener.accept().await else { break };
            s.peers.lock().unwrap().push(peer.ip());
            let _ = sock.set_nodelay(true);
            let (c, s) = (c.clone(), s.clone());
            tokio::spawn(async move { handle(sock, c, s).await });
        }
    });
    TestServer { addr, cfg, stats }
}

// ---------- deterministic content ------------------------------------------------------------

fn splitmix(x: u64) -> u64 {
    let mut z = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// Fill `buf` with the bytes of the generated file starting at `offset`.
pub fn fill(seed: u64, offset: u64, buf: &mut [u8]) {
    let key = seed.wrapping_mul(0xD6E8_FEB8_6659_FD93);
    let mut pos = offset;
    let mut i = 0usize;
    while i < buf.len() {
        let skip = (pos % 8) as usize;
        let n = (8 - skip).min(buf.len() - i);
        let bytes = splitmix((pos / 8) ^ key).to_le_bytes();
        buf[i..i + n].copy_from_slice(&bytes[skip..skip + n]);
        i += n;
        pos += n as u64;
    }
}

pub fn sha256_hex_of_generated(seed: u64, size: u64) -> String {
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    let mut off = 0u64;
    while off < size {
        let n = ((size - off) as usize).min(buf.len());
        fill(seed, off, &mut buf[..n]);
        h.update(&buf[..n]);
        off += n as u64;
    }
    hex::encode(h.finalize())
}

pub fn sha256_file(path: &std::path::Path) -> String {
    use std::io::Read;
    let mut f = std::fs::File::open(path).expect("open downloaded file");
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).unwrap();
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    hex::encode(h.finalize())
}

// ---------- request handling -----------------------------------------------------------------

struct Request {
    method: String,
    path: String,
    headers: HashMap<String, String>,
}

async fn read_request(sock: &mut TcpStream) -> Option<Request> {
    let mut data = Vec::new();
    let mut buf = [0u8; 2048];
    loop {
        let n = sock.read(&mut buf).await.ok()?;
        if n == 0 {
            return None;
        }
        data.extend_from_slice(&buf[..n]);
        if data.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
        if data.len() > 64 * 1024 {
            return None;
        }
    }
    let text = String::from_utf8_lossy(&data).to_string();
    let mut lines = text.split("\r\n");
    let first = lines.next()?;
    let mut parts = first.split_whitespace();
    let method = parts.next()?.to_string();
    let path = parts.next()?.to_string();
    let mut headers = HashMap::new();
    for l in lines {
        if l.is_empty() {
            break;
        }
        if let Some((k, v)) = l.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }
    Some(Request { method, path, headers })
}

async fn respond(sock: &mut TcpStream, status: &str, headers: &[(&str, String)]) -> bool {
    let mut s = format!("HTTP/1.1 {status}\r\n");
    for (k, v) in headers {
        s.push_str(&format!("{k}: {v}\r\n"));
    }
    s.push_str("Connection: close\r\n\r\n");
    sock.write_all(s.as_bytes()).await.is_ok()
}

/// `bytes=a-b` or `bytes=a-` -> inclusive range, if satisfiable.
fn parse_range(value: &str, size: u64) -> Option<(u64, u64)> {
    let spec = value.strip_prefix("bytes=")?;
    let (a, b) = spec.split_once('-')?;
    let start: u64 = a.trim().parse().ok()?;
    let end: u64 = if b.trim().is_empty() { size.checked_sub(1)? } else { b.trim().parse().ok()? };
    if start >= size || end < start {
        return None;
    }
    Some((start, end.min(size - 1)))
}

fn auth_params(header: &str) -> HashMap<String, String> {
    let mut m = HashMap::new();
    let rest = header.trim_start_matches("Digest").trim();
    for part in rest.split(", ") {
        if let Some((k, v)) = part.split_once('=') {
            m.insert(k.trim().to_string(), v.trim().trim_matches('"').to_string());
        }
    }
    m
}

fn md5_hex(s: &str) -> String {
    hex::encode(Md5::digest(s.as_bytes()))
}

/// `true` if the request is authorised; otherwise a 401 has been sent.
async fn check_auth(sock: &mut TcpStream, req: &Request, mode: &AuthMode) -> bool {
    let header = req.headers.get("authorization");
    match mode {
        AuthMode::None => true,
        AuthMode::Basic { user, pass } => {
            let expected = format!(
                "Basic {}",
                base64::engine::general_purpose::STANDARD.encode(format!("{user}:{pass}"))
            );
            if header.map(|h| h == &expected).unwrap_or(false) {
                return true;
            }
            respond(
                sock,
                "401 Unauthorized",
                &[("WWW-Authenticate", "Basic realm=\"test\"".into()), ("Content-Length", "0".into())],
            )
            .await;
            false
        }
        AuthMode::Digest { user, pass } => {
            const REALM: &str = "test";
            const NONCE: &str = "dcd98b7102dd2f0e8b11d0f600bfb0c093";
            if let Some(h) = header {
                let p = auth_params(h);
                let ha1 = md5_hex(&format!("{user}:{REALM}:{pass}"));
                let ha2 = md5_hex(&format!("{}:{}", req.method, p.get("uri").cloned().unwrap_or_default()));
                let expected = md5_hex(&format!(
                    "{ha1}:{NONCE}:{}:{}:auth:{ha2}",
                    p.get("nc").cloned().unwrap_or_default(),
                    p.get("cnonce").cloned().unwrap_or_default()
                ));
                let uri_ok = p.get("uri").map(|u| u == &req.path).unwrap_or(false);
                if p.get("username") == Some(user)
                    && p.get("nonce").map(String::as_str) == Some(NONCE)
                    && uri_ok
                    && p.get("response") == Some(&expected)
                {
                    return true;
                }
            }
            respond(
                sock,
                "401 Unauthorized",
                &[
                    (
                        "WWW-Authenticate",
                        format!("Digest realm=\"{REALM}\", qop=\"auth\", nonce=\"{NONCE}\", algorithm=MD5, opaque=\"op\""),
                    ),
                    ("Content-Length", "0".into()),
                ],
            )
            .await;
            false
        }
    }
}

struct ActiveGuard(Arc<Stats>);
impl ActiveGuard {
    fn new(stats: &Arc<Stats>) -> Self {
        let now = stats.active.fetch_add(1, Ordering::SeqCst) + 1;
        stats.peak_connections.fetch_max(now, Ordering::SeqCst);
        Self(stats.clone())
    }
}
impl Drop for ActiveGuard {
    fn drop(&mut self) {
        self.0.active.fetch_sub(1, Ordering::SeqCst);
    }
}

async fn handle(mut sock: TcpStream, cfg: Arc<Mutex<ServerConfig>>, stats: Arc<Stats>) {
    // Internet cut: connections are accepted by the OS but immediately closed.
    if stats.offline.load(Ordering::SeqCst) {
        return;
    }
    let Some(req) = read_request(&mut sock).await else { return };
    stats.requests.fetch_add(1, Ordering::SeqCst);
    stats.headers.lock().unwrap().push(req.headers.clone());
    let cfg = cfg.lock().unwrap().clone();

    let (route, query) = match req.path.split_once('?') {
        Some((p, q)) => (p.to_string(), q.to_string()),
        None => (req.path.clone(), String::new()),
    };
    match route.as_str() {
        "/redir" => {
            respond(&mut sock, "302 Found", &[("Location", "/file.bin".into()), ("Content-Length", "0".into())]).await;
            return;
        }
        "/loop" => {
            respond(&mut sock, "302 Found", &[("Location", "/loop".into()), ("Content-Length", "0".into())]).await;
            return;
        }
        // A "download page" that redirects to a fresh signed link every time.
        "/link" => {
            if cfg.link_dead {
                stats.forbidden.fetch_add(1, Ordering::SeqCst);
                respond(&mut sock, "403 Forbidden", &[("Content-Length", "0".into())]).await;
                return;
            }
            let token = stats.issued.fetch_add(1, Ordering::SeqCst);
            respond(
                &mut sock,
                "302 Found",
                &[("Location", format!("/file.bin?token={token}")), ("Content-Length", "0".into())],
            )
            .await;
            return;
        }
        "/file.bin" => {}
        // A sign-in page where a file was expected.
        "/login.zip" => {
            let body = "<html><body>Please sign in to download</body></html>";
            respond(
                &mut sock,
                "200 OK",
                &[("Content-Type", "text/html; charset=utf-8".into()), ("Content-Length", body.len().to_string())],
            )
            .await;
            if req.method != "HEAD" {
                let _ = sock.write_all(body.as_bytes()).await;
            }
            return;
        }
        _ => {
            respond(&mut sock, "404 Not Found", &[("Content-Length", "0".into())]).await;
            return;
        }
    }

    if cfg.require_token {
        let token: Option<u64> = query.split('&').find_map(|kv| kv.strip_prefix("token=")).and_then(|v| v.parse().ok());
        if token.is_none_or(|t| t < cfg.min_valid_token) {
            stats.forbidden.fetch_add(1, Ordering::SeqCst);
            respond(&mut sock, "403 Forbidden", &[("Content-Length", "0".into())]).await;
            return;
        }
    }

    if !check_auth(&mut sock, &req, &cfg.auth).await {
        return;
    }

    let is_head = req.method == "HEAD";
    if is_head && !cfg.head {
        respond(&mut sock, "405 Method Not Allowed", &[("Content-Length", "0".into())]).await;
        return;
    }
    if !is_head {
        stats.get_requests.fetch_add(1, Ordering::SeqCst);
        if !req.headers.contains_key("range") {
            stats.full_gets.fetch_add(1, Ordering::SeqCst);
        }
        if let Some(status) = cfg.fail_status {
            let mut h = vec![("Content-Length", "0".to_string())];
            if let Some(s) = cfg.retry_after {
                h.push(("Retry-After", s.to_string()));
            }
            respond(&mut sock, &format!("{status} Error"), &h).await;
            return;
        }
    }

    // A transfer slot: GETs beyond `max_concurrent` are dropped like an overloaded server would.
    let _slot = if is_head {
        None
    } else {
        let guard = ActiveGuard::new(&stats);
        if cfg.max_concurrent.is_some_and(|m| stats.active.load(Ordering::SeqCst) > m) {
            stats.refused.fetch_add(1, Ordering::SeqCst);
            if let Some(status) = cfg.busy_status {
                respond(&mut sock, &format!("{status} Busy"), &[("Content-Length", "0".to_string())]).await;
            }
            return; // guard dropped, socket closed (without an answer unless `busy_status` is set)
        }
        Some(guard)
    };

    // Which bytes?
    let mut range: Option<(u64, u64)> = None;
    if cfg.ranges && !is_head {
        if let Some(r) = req.headers.get("range") {
            stats.ranged_requests.fetch_add(1, Ordering::SeqCst);
            // If-Range with a stale validator means "send everything".
            let validator_ok = req.headers.get("if-range").map(|v| Some(v) == cfg.etag.as_ref()).unwrap_or(true);
            if validator_ok {
                match parse_range(r, cfg.size) {
                    Some(rg) => {
                        stats.range_starts.lock().unwrap().push(rg.0);
                        range = Some(rg);
                    }
                    None => {
                        respond(
                            &mut sock,
                            "416 Range Not Satisfiable",
                            &[("Content-Range", format!("bytes */{}", cfg.size)), ("Content-Length", "0".into())],
                        )
                        .await;
                        return;
                    }
                }
            }
        }
    }

    let mut h: Vec<(&str, String)> = vec![
        ("Content-Type", "application/octet-stream".into()),
        ("Last-Modified", "Wed, 21 Oct 2015 07:28:00 GMT".into()),
    ];
    if let Some(e) = &cfg.etag {
        h.push(("ETag", e.clone()));
    }
    if cfg.ranges {
        h.push(("Accept-Ranges", "bytes".into()));
    }
    if let Some(n) = &cfg.file_name {
        h.push(("Content-Disposition", format!("attachment; filename=\"{n}\"")));
    }
    if let Some(a) = &cfg.alt_svc {
        h.push(("Alt-Svc", a.clone()));
    }

    let (status, start, len) = match range {
        Some((a, b)) => {
            h.push(("Content-Range", format!("bytes {a}-{b}/{}", cfg.size)));
            ("206 Partial Content", a, b - a + 1)
        }
        None => ("200 OK", 0, cfg.size),
    };
    let chunked = cfg.chunked && range.is_none();
    if chunked {
        h.push(("Transfer-Encoding", "chunked".into()));
    } else {
        h.push(("Content-Length", len.to_string()));
    }
    if !respond(&mut sock, status, &h).await || is_head {
        return;
    }

    // Per-connection misbehaviour, keyed by where this request's range starts.
    let mut rate = cfg.rate_per_conn;
    let mut stall_after: Option<u64> = None;
    for (i, t) in cfg.trouble.iter().enumerate() {
        if t.start != start {
            continue;
        }
        if t.once && !stats.triggered.lock().unwrap().insert(i) {
            continue; // already misbehaved once
        }
        match t.kind {
            TroubleKind::Slow(bps) => rate = bps,
            TroubleKind::StallAfter(n) => stall_after = Some(n),
        }
    }

    use rand::{Rng, SeedableRng};
    let lossy = cfg.loss > 0.0 || cfg.random_disconnect > 0.0;
    let mut rng = rand::rngs::StdRng::seed_from_u64(cfg.seed ^ stats.requests.load(Ordering::SeqCst).wrapping_mul(0x9E37_79B9));
    // Body
    let mut buf = vec![0u8; 64 * 1024];
    let mut sent = 0u64;
    while sent < len {
        if stats.offline.load(Ordering::SeqCst) {
            return; // the internet just went away: cut the transfer
        }
        let mut n = ((len - sent) as usize).min(buf.len());
        if lossy {
            n = n.min(16 * 1024); // loss is applied per 16 KiB block
            if rng.gen_bool(cfg.random_disconnect.clamp(0.0, 1.0)) {
                return; // abrupt disconnect
            }
            if rng.gen_bool(cfg.loss.clamp(0.0, 1.0)) {
                if rng.gen_bool(cfg.loss_reset_share.clamp(0.0, 1.0)) {
                    return; // the retransmission timer gave up: connection reset
                }
                tokio::time::sleep(Duration::from_millis(cfg.loss_delay_ms)).await; // retransmission
            }
        }
        if let Some(max) = cfg.max_bytes_per_response {
            if sent >= max {
                return; // drop the connection mid-body
            }
            n = n.min((max - sent) as usize);
        }
        if let Some(limit) = stall_after {
            if sent >= limit {
                // Go silent but keep the connection open, like a wedged server or middlebox.
                tokio::time::sleep(Duration::from_secs(120)).await;
                return;
            }
            n = n.min((limit - sent) as usize);
        }
        fill(cfg.seed, start + sent, &mut buf[..n]);
        let ok = if chunked {
            let mut frame = format!("{n:x}\r\n").into_bytes();
            frame.extend_from_slice(&buf[..n]);
            frame.extend_from_slice(b"\r\n");
            sock.write_all(&frame).await.is_ok()
        } else {
            sock.write_all(&buf[..n]).await.is_ok()
        };
        if !ok {
            return;
        }
        sent += n as u64;
        stats.bytes_sent.fetch_add(n as u64, Ordering::SeqCst);
        if rate > 0 {
            tokio::time::sleep(Duration::from_secs_f64(n as f64 / rate as f64)).await;
        }
    }
    if chunked {
        let _ = sock.write_all(b"0\r\n\r\n").await;
    }
    let _ = sock.shutdown().await;
}
