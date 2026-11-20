//! The [`Engine`]: owns every download and drives its lifecycle.
//!
//! ```text
//!   add ─► Probing ─► Downloading ─► (Verifying) ─► Completed
//!             │            │  ▲  ▲
//!             │          pause│resume   internet back
//!             ▼            ▼  │  │
//!           Failed        Paused   WaitingForNetwork     LinkExpired (needs a fresh link)
//!                                                         cancel ─► Cancelled   restart ─► Probing
//! ```
//!
//! # How a download runs (Phase 2)
//! * **Dynamic segmentation (work stealing):** the file starts as N segments. Whenever a
//!   connection has nothing left to do, it splits the remainder of the segment that will take
//!   longest to finish and starts working on the second half. No connection idles while work
//!   remains.
//! * **Stall detection:** a connection with no data for 3 s (configurable), or running below 10 %
//!   of the average segment speed for 8 s, is closed and reopened on the same range.
//! * **Adaptive connection count:** if connections keep failing (and the internet is up), the
//!   count is halved. The count that worked best is remembered per domain.
//! * **Network supervisor:** when the internet drops, every active download is parked in
//!   *Waiting for network* and resumed the moment connectivity returns.
//! * **Link refresh:** a 403/410 mid-download triggers a re-probe of the original link; if it
//!   yields the same file the download continues from where it was.
//!
//! # Crash safety
//! While a download runs, every `checkpoint_interval` the engine (1) snapshots the segment table,
//! (2) `fsync`s the file, and only then (3) emits [`EngineEvent::Persist`] with that snapshot. The
//! database therefore never claims bytes that are not on disk.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::sync::mpsc::UnboundedSender;
use tokio::sync::oneshot;
use tokio::task::{JoinHandle, JoinSet};
use tokio::time::MissedTickBehavior;
use tokio_util::sync::CancellationToken;
use url::Url;

use crate::checksum::{self, Checksum};
use crate::error::{EngineError, RetryClass, UserError};
use crate::adapters::{self, AdapterInfo};
use crate::events::{AdapterProgress, DomainBest, EngineEvent, ProgressEvent, SegmentProgress};
use crate::filename;
use crate::http::{H3Memory, H3Plan, HttpSession};
use crate::limiter::RateLimiter;
use crate::model::{AddRequest, DownloadInfo, DownloadRecord, DownloadState, MirrorReport};
use crate::netwatch::{Connectivity, FailLog, NetState, SystemConnectivity};
use crate::policy;
use crate::probe::{self, ProbeResult};
use crate::progress::{self, SpeedMeter};
use crate::segments::{self, Segment, MIN_STEAL_SIZE};
use crate::table::SegmentTable;
use crate::worker::{protocol_name, run_segment, AdapterSet, RetryPolicy, SourceSet, WorkerCtx, WorkerExit};
use crate::writer::{DiskWriter, OffsetFile};

pub const MIN_CONNECTIONS: u32 = 1;
pub const MAX_CONNECTIONS: u32 = 32;

/// Downloads smaller than this say nothing about a domain's best connection count.
const MIN_HINT_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Clone, Debug)]
pub struct EngineConfig {
    /// Where downloads go when the request does not say.
    pub default_dir: PathBuf,
    /// Default number of connections (1-32) when neither the request nor the domain memory says.
    pub default_connections: u32,
    pub retry: RetryPolicy,
    /// How often progress events are emitted.
    pub progress_interval: Duration,
    /// How often progress is fsync'ed and persisted to SQLite (2 s).
    pub checkpoint_interval: Duration,

    // ---- Phase 2 ----
    /// Dynamic segmentation (work stealing).
    pub work_stealing: bool,
    /// Never split off a piece smaller than this (256 KiB).
    pub min_steal_size: u64,
    /// Close a connection that received 0 bytes for this long (3 s).
    pub stall_zero_after: Duration,
    /// Close a connection below `stall_slow_ratio` x average segment speed for this long (8 s).
    pub stall_slow_after: Duration,
    pub stall_slow_ratio: f64,
    /// Halve the connection count when this many connections failed within `fail_window` ...
    pub fail_threshold: usize,
    pub fail_window: Duration,
    /// ... but not more often than this.
    pub halve_cooldown: Duration,
    /// How many times an expired link is refreshed before asking the user for a new one.
    pub max_refresh_attempts: u32,
    /// While offline, how often to re-check the connection.
    pub offline_poll: Duration,
    /// Use HTTP/3 when the server advertises it (`Alt-Svc`), falling back to TCP if QUIC fails.
    pub http3: H3Plan,
    /// How long a mirror gets to answer its verification probe.
    pub mirror_probe_timeout: Duration,
    /// AIMD: a download starts with this many connections and grows from there (0 = start at the
    /// full count, i.e. no ramp-up). Never above the download's own connection count.
    pub aimd_start: u32,
    /// AIMD: how often the total speed is compared and a connection may be added (2 s).
    pub aimd_interval: Duration,
    /// AIMD: add one connection only if the speed rose by more than this fraction (0.05 = 5 %).
    pub aimd_gain: f64,
    /// Turbo Mode: bind connections to all active network adapters (can be switched at runtime).
    pub turbo_mode: bool,
    /// Use exactly these adapters instead of detecting them (tests, or a user-chosen subset).
    pub adapter_override: Option<Vec<AdapterInfo>>,
}

impl EngineConfig {
    pub fn new(default_dir: PathBuf) -> Self {
        Self {
            default_dir,
            default_connections: 8,
            retry: RetryPolicy::default(),
            progress_interval: Duration::from_millis(250),
            checkpoint_interval: Duration::from_secs(2),
            work_stealing: true,
            min_steal_size: MIN_STEAL_SIZE,
            stall_zero_after: Duration::from_secs(3),
            stall_slow_after: Duration::from_secs(8),
            stall_slow_ratio: 0.10,
            fail_threshold: 4,
            fail_window: Duration::from_secs(20),
            halve_cooldown: Duration::from_secs(20),
            max_refresh_attempts: 3,
            offline_poll: Duration::from_secs(2),
            http3: H3Plan::Auto,
            mirror_probe_timeout: Duration::from_secs(15),
            aimd_start: 4,
            aimd_interval: Duration::from_secs(2),
            aimd_gain: 0.05,
            turbo_mode: false,
            adapter_override: None,
        }
    }
}

/// The connection count that worked best for a website.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DomainHint {
    pub domain: String,
    pub connections: u32,
    pub speed_bps: u64,
}

/// Decide whether a finished download's result should replace what we remember for the domain.
/// Returns the new memory, or `None` to keep the old one.
///
/// * nothing remembered yet: remember this;
/// * `forced`: connections were cut because the server kept failing them, so remember the reduced
///   count whatever the speed was;
/// * clearly faster (> 10 %): remember it;
/// * about as fast (within 10 %) with **fewer** connections: remember it (same speed, less load);
/// * same connection count but under half the remembered speed: the network got slower, so refresh
///   the stored speed (keeping later comparisons honest) without changing the count.
pub fn merge_hint(old: Option<&DomainHint>, domain: &str, conns: u32, speed: u64, forced: bool) -> Option<DomainHint> {
    let new = DomainHint {
        domain: domain.to_string(),
        connections: conns.clamp(MIN_CONNECTIONS, MAX_CONNECTIONS),
        speed_bps: speed,
    };
    let Some(o) = old else { return Some(new) };
    if forced {
        return (o.connections != new.connections).then_some(new);
    }
    let (old_speed, s) = (o.speed_bps as f64, speed as f64);
    let replace = s > old_speed * 1.10
        || (s >= old_speed * 0.90 && new.connections < o.connections)
        || (new.connections == o.connections && s < old_speed * 0.5);
    (replace && new != *o).then_some(new)
}

// Why a run was told to stop.
const REASON_NONE: u8 = 0;
const REASON_PAUSE: u8 = 1;
const REASON_CANCEL: u8 = 2;
const REASON_NETWORK: u8 = 3;

enum Outcome {
    Completed,
    Stopped,
}

#[derive(Default)]
struct Live {
    speed: u64,
    eta: Option<u64>,
    note: Option<String>,
    protocol: Option<String>,
}

struct RunHandle {
    cancel: CancellationToken,
    reason: Arc<AtomicU8>,
    join: JoinHandle<()>,
}

struct Entry {
    id: String,
    record: Mutex<DownloadRecord>,
    live: Mutex<Live>,
    /// Per-download speed limit.
    limiter: Arc<RateLimiter>,
    run: tokio::sync::Mutex<Option<RunHandle>>,
}

impl Entry {
    fn new(record: DownloadRecord) -> Arc<Self> {
        Arc::new(Self {
            id: record.id.clone(),
            limiter: Arc::new(RateLimiter::new(record.speed_limit)),
            record: Mutex::new(record),
            live: Mutex::new(Live::default()),
            run: tokio::sync::Mutex::new(None),
        })
    }

    fn with<R>(&self, f: impl FnOnce(&mut DownloadRecord) -> R) -> R {
        f(&mut self.record.lock().unwrap())
    }

    fn snapshot(&self) -> DownloadRecord {
        self.record.lock().unwrap().clone()
    }

    fn state(&self) -> DownloadState {
        self.record.lock().unwrap().state
    }

    fn info(&self) -> DownloadInfo {
        let r = self.record.lock().unwrap();
        let live = self.live.lock().unwrap();
        let active = r.state.is_active();
        let show_segments = active
            || matches!(
                r.state,
                DownloadState::Paused | DownloadState::WaitingForNetwork | DownloadState::LinkExpired
            );
        DownloadInfo {
            id: r.id.clone(),
            url: r.url.clone(),
            file_name: r.file_name.clone(),
            file_path: r.file_path.clone(),
            save_dir: r.save_dir.clone(),
            total_size: r.total_size,
            downloaded: r.downloaded,
            state: r.state,
            resume_supported: r.resume_supported,
            mime: r.mime.clone(),
            connections: r.connections,
            speed_limit: r.speed_limit,
            checksum: r.checksum.as_ref().map(|c| format!("{}:{}", c.algo, c.hex)),
            checksum_verified: r.checksum_verified,
            error: r.error.clone(),
            created_at: r.created_at,
            completed_at: r.completed_at,
            speed_bps: if active { live.speed } else { 0 },
            eta_secs: if active { live.eta } else { None },
            segments: if show_segments { r.segments.iter().map(SegmentProgress::from).collect() } else { Vec::new() },
            note: if active { live.note.clone() } else { None },
            protocol: if active { live.protocol.clone() } else { None },
            mirrors: r.mirror_report.clone(),
            category: r.category.clone(),
            queue_id: r.queue_id.clone(),
            queue_order: r.queue_order,
        }
    }
}

struct Inner {
    cfg: Mutex<EngineConfig>,
    entries: Mutex<HashMap<String, Arc<Entry>>>,
    tx: UnboundedSender<EngineEvent>,
    /// Limit shared by all downloads.
    global: Arc<RateLimiter>,
    /// Online / offline state shared with every connection.
    net: Arc<NetState>,
    conn: Arc<dyn Connectivity>,
    /// Best connection count learned per domain.
    hints: Mutex<HashMap<String, DomainHint>>,
    /// Websites that did not answer over QUIC recently.
    h3_memory: H3Memory,
    /// Turbo Mode switch, shared with every running download's adapter set.
    turbo: Arc<AtomicBool>,
}

impl Inner {
    fn send(&self, ev: EngineEvent) {
        // The receiver only disappears when the app is shutting down.
        let _ = self.tx.send(ev);
    }

    fn persist(&self, e: &Entry) {
        self.send(EngineEvent::Persist(Box::new(e.snapshot())));
    }

    fn emit_updated(&self, e: &Entry) {
        self.send(EngineEvent::Updated(e.info()));
    }

    fn set_state(&self, e: &Entry, state: DownloadState, error: Option<UserError>) {
        e.with(|r| {
            r.state = state;
            r.error = error;
        });
        if !state.is_active() {
            *e.live.lock().unwrap() = Live::default();
        }
        self.emit_updated(e);
        self.persist(e);
    }
}

fn now_secs() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn domain_of(url: &Url) -> Option<String> {
    url.host_str().map(|h| h.to_ascii_lowercase())
}

/// Public handle to the download engine. Cheap to clone.
#[derive(Clone)]
pub struct Engine {
    inner: Arc<Inner>,
}

impl Engine {
    pub fn new(cfg: EngineConfig, tx: UnboundedSender<EngineEvent>) -> Self {
        Self::with_connectivity(cfg, tx, Arc::new(SystemConnectivity::new()))
    }

    /// Like [`Engine::new`] with a custom network probe (used by tests to simulate an outage).
    pub fn with_connectivity(cfg: EngineConfig, tx: UnboundedSender<EngineEvent>, conn: Arc<dyn Connectivity>) -> Self {
        let turbo = Arc::new(AtomicBool::new(cfg.turbo_mode));
        Self {
            inner: Arc::new(Inner {
                turbo,
                cfg: Mutex::new(cfg),
                entries: Mutex::new(HashMap::new()),
                tx,
                global: Arc::new(RateLimiter::new(0)),
                net: Arc::new(NetState::new()),
                conn,
                hints: Mutex::new(HashMap::new()),
                h3_memory: H3Memory::default(),
            }),
        }
    }

    // ---- settings -------------------------------------------------------------------------

    pub fn default_connections(&self) -> u32 {
        self.inner.cfg.lock().unwrap().default_connections
    }

    pub fn set_default_connections(&self, n: u32) {
        self.inner.cfg.lock().unwrap().default_connections = n.clamp(MIN_CONNECTIONS, MAX_CONNECTIONS);
    }

    pub fn default_dir(&self) -> PathBuf {
        self.inner.cfg.lock().unwrap().default_dir.clone()
    }

    pub fn global_speed_limit(&self) -> u64 {
        self.inner.global.rate()
    }

    /// Limit shared by all downloads, in bytes/second (0 = unlimited).
    pub fn set_global_speed_limit(&self, bytes_per_sec: u64) {
        self.inner.global.set_rate(bytes_per_sec);
    }

    /// Limit for one download, in bytes/second (0 = unlimited). Persisted with the download.
    pub fn set_download_speed_limit(&self, id: &str, bytes_per_sec: u64) -> Result<(), EngineError> {
        let e = self.get(id)?;
        e.limiter.set_rate(bytes_per_sec);
        e.with(|r| r.speed_limit = bytes_per_sec);
        self.inner.emit_updated(&e);
        self.inner.persist(&e);
        Ok(())
    }

    /// Turbo Mode: spread connections over every active network adapter (Wi-Fi, Ethernet, USB
    /// tethering, ...). Takes effect immediately for new connections of running downloads.
    pub fn set_turbo_mode(&self, on: bool) {
        self.inner.turbo.store(on, Ordering::SeqCst);
        self.inner.cfg.lock().unwrap().turbo_mode = on;
    }

    pub fn turbo_mode(&self) -> bool {
        self.inner.turbo.load(Ordering::SeqCst)
    }

    /// The network adapters Turbo Mode can use right now.
    pub fn adapters(&self) -> Vec<AdapterInfo> {
        match &self.inner.cfg.lock().unwrap().adapter_override {
            Some(list) => list.clone(),
            None => adapters::detect(),
        }
    }

    /// Load the per-domain connection counts remembered by earlier runs.
    pub fn set_domain_hints(&self, hints: Vec<DomainHint>) {
        let mut map = self.inner.hints.lock().unwrap();
        for h in hints {
            map.insert(h.domain.clone(), h);
        }
    }

    pub fn domain_hint(&self, domain: &str) -> Option<DomainHint> {
        self.inner.hints.lock().unwrap().get(&domain.to_ascii_lowercase()).cloned()
    }

    /// Is the internet currently believed to be reachable?
    pub fn is_online(&self) -> bool {
        self.inner.net.is_online()
    }

    // ---- startup / shutdown ---------------------------------------------------------------

    /// Load downloads saved by a previous run. Anything that was in progress when the app
    /// closed or crashed comes back as *Paused*, with its saved progress, ready to resume.
    pub fn restore(&self, records: Vec<DownloadRecord>) {
        let mut map = self.inner.entries.lock().unwrap();
        for mut rec in records {
            if rec.state.is_active() || rec.state == DownloadState::WaitingForNetwork {
                rec.state = DownloadState::Paused;
            }
            let entry = Entry::new(rec);
            map.insert(entry.id.clone(), entry);
        }
    }

    /// Pause everything and wait until all progress has been written and persisted.
    pub async fn shutdown(&self) {
        let entries: Vec<Arc<Entry>> = self.inner.entries.lock().unwrap().values().cloned().collect();
        let stops = entries
            .iter()
            .filter(|e| e.state().is_active())
            .map(|e| self.stop(e, REASON_PAUSE));
        futures_util::future::join_all(stops).await;
        // Wait for the event consumer to catch up so the last checkpoint is in the database.
        let (tx, rx) = oneshot::channel();
        self.inner.send(EngineEvent::Flush(tx));
        let _ = tokio::time::timeout(Duration::from_secs(5), rx).await;
    }

    // ---- network supervisor ---------------------------------------------------------------

    /// Watch the network for the lifetime of the app (spawn this once, e.g. with
    /// `tokio::spawn(engine.run_network_monitor())`).
    ///
    /// When the internet goes away, every active download is saved and parked in *Waiting for
    /// network*. The moment it comes back (OS network-change event, or the periodic check) they
    /// are resumed automatically. Downloads the user paused stay paused.
    pub async fn run_network_monitor(&self) {
        const DEBOUNCE: Duration = Duration::from_millis(300);
        let inner = self.inner.clone();
        loop {
            // Online: sleep until something suggests the network may have changed.
            tokio::select! {
                _ = inner.conn.changed() => tokio::time::sleep(DEBOUNCE).await,
                _ = inner.net.check_requested() => {}
            }
            if inner.conn.check().await {
                inner.net.set_online(true);
                continue;
            }

            // Offline.
            inner.net.set_online(false);
            self.pause_all_for_network().await;
            let poll = inner.cfg.lock().unwrap().offline_poll;
            loop {
                tokio::select! {
                    _ = inner.conn.changed() => tokio::time::sleep(DEBOUNCE).await,
                    _ = tokio::time::sleep(poll) => {}
                }
                if inner.conn.check().await {
                    break;
                }
            }
            inner.net.set_online(true);
            self.resume_waiting().await;
        }
    }

    async fn pause_all_for_network(&self) {
        let entries: Vec<Arc<Entry>> = self.inner.entries.lock().unwrap().values().cloned().collect();
        let stops = entries
            .iter()
            // Verifying only reads the local disk, so it can carry on.
            .filter(|e| matches!(e.state(), DownloadState::Probing | DownloadState::Downloading))
            .map(|e| self.stop(e, REASON_NETWORK));
        futures_util::future::join_all(stops).await;
    }

    async fn resume_waiting(&self) {
        let entries: Vec<Arc<Entry>> = self.inner.entries.lock().unwrap().values().cloned().collect();
        for e in entries {
            if e.state() == DownloadState::WaitingForNetwork {
                self.stop(&e, REASON_NONE).await; // reap the finished run
                self.start_run(&e).await;
            }
        }
    }

    // ---- queries --------------------------------------------------------------------------

    fn get(&self, id: &str) -> Result<Arc<Entry>, EngineError> {
        self.inner
            .entries
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| EngineError::NotFound(id.to_string()))
    }

    pub fn list(&self) -> Vec<DownloadInfo> {
        let mut v: Vec<DownloadInfo> = self.inner.entries.lock().unwrap().values().map(|e| e.info()).collect();
        v.sort_by(|a, b| a.created_at.cmp(&b.created_at).then_with(|| a.id.cmp(&b.id)));
        v
    }

    pub fn info(&self, id: &str) -> Result<DownloadInfo, EngineError> {
        Ok(self.get(id)?.info())
    }

    // ---- commands -------------------------------------------------------------------------

    /// Add a download and (unless `start_paused`) start it right away.
    pub async fn add(&self, req: AddRequest) -> Result<DownloadInfo, EngineError> {
        let url = Url::parse(req.url.trim())?;
        policy::check_url(&url)?;
        req.http.validate()?;
        let checksum = match req.checksum.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            Some(s) => Some(Checksum::parse(s)?),
            None => None,
        };
        // Mirrors: other places that hold the same file. Bad links are rejected up front.
        let mut mirrors: Vec<String> = Vec::new();
        for m in req.mirrors.iter().map(|s| s.trim()).filter(|s| !s.is_empty()) {
            let mu = Url::parse(m)
                .map_err(|_| EngineError::InvalidUrl(format!("The mirror link \"{m}\" doesn't look valid.")))?;
            policy::check_url(&mu)?;
            let s = mu.to_string();
            if mu != url && !mirrors.contains(&s) {
                mirrors.push(s);
            }
        }
        let cfg = self.inner.cfg.lock().unwrap().clone();
        // Connections: what the user asked for, else what worked best for this website before,
        // else the default.
        let remembered = domain_of(&url).and_then(|d| self.inner.hints.lock().unwrap().get(&d).map(|h| h.connections));
        let connections = req
            .connections
            .or(remembered)
            .unwrap_or(cfg.default_connections)
            .clamp(MIN_CONNECTIONS, MAX_CONNECTIONS);
        let save_dir = req
            .save_dir
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(PathBuf::from)
            .unwrap_or(cfg.default_dir);

        let user_name = req
            .file_name
            .as_deref()
            .map(filename::sanitize)
            .filter(|n| !n.is_empty());
        let locked = user_name.is_some();
        let file_name = user_name
            .or_else(|| filename::from_url(&url))
            .unwrap_or_else(|| "download".to_string());

        let record = DownloadRecord {
            id: uuid::Uuid::new_v4().to_string(),
            url: url.to_string(),
            final_url: None,
            save_dir: save_dir.to_string_lossy().to_string(),
            file_name,
            file_name_locked: locked,
            file_path: String::new(),
            total_size: None,
            downloaded: 0,
            resume_supported: None,
            mime: None,
            etag: None,
            last_modified: None,
            segments: Vec::new(),
            connections,
            speed_limit: req.speed_limit.unwrap_or(0),
            http: req.http,
            checksum,
            checksum_verified: None,
            mirrors,
            mirror_report: Vec::new(),
            state: if req.start_queued {
                DownloadState::Queued
            } else if req.start_paused {
                DownloadState::Paused
            } else {
                DownloadState::Probing
            },
            error: None,
            created_at: now_secs(),
            completed_at: None,
            category: req.category,
            queue_id: req.queue_id.or_else(|| Some("main".to_string())),
            queue_order: req.queue_order.or(Some(0)),
        };
        let entry = Entry::new(record);
        self.inner.entries.lock().unwrap().insert(entry.id.clone(), entry.clone());
        self.inner.emit_updated(&entry);
        self.inner.persist(&entry);
        if !req.start_paused && !req.start_queued {
            self.start_run(&entry).await;
        }
        Ok(entry.info())
    }

    /// Pause a running download. Progress is saved; resume continues from the same bytes.
    pub async fn pause(&self, id: &str) -> Result<(), EngineError> {
        let e = self.get(id)?;
        match e.state() {
            s if s.is_active() => {
                self.stop(&e, REASON_PAUSE).await;
                Ok(())
            }
            DownloadState::WaitingForNetwork => {
                // The user takes over: do not auto-resume this one when the internet returns.
                self.inner.set_state(&e, DownloadState::Paused, None);
                Ok(())
            }
            DownloadState::Queued => {
                self.inner.set_state(&e, DownloadState::Paused, None);
                Ok(())
            }
            DownloadState::Paused => Ok(()),
            _ => Err(EngineError::InvalidState("Only a running download can be paused.".into())),
        }
    }

    /// Mark a download as queued (ready to run when queue slot opens).
    pub async fn mark_queued(&self, id: &str) -> Result<(), EngineError> {
        let e = self.get(id)?;
        if e.state().is_active() {
            self.stop(&e, REASON_PAUSE).await;
        }
        self.inner.set_state(&e, DownloadState::Queued, None);
        Ok(())
    }

    /// Update category, queue or order metadata.
    pub fn set_download_meta(
        &self,
        id: &str,
        category: Option<String>,
        queue_id: Option<String>,
        queue_order: Option<i32>,
    ) -> Result<DownloadInfo, EngineError> {
        let e = self.get(id)?;
        {
            let mut r = e.record.lock().unwrap();
            if category.is_some() {
                r.category = category;
            }
            if queue_id.is_some() {
                r.queue_id = queue_id;
            }
            if let Some(o) = queue_order {
                r.queue_order = Some(o);
            }
        }
        self.inner.emit_updated(&e);
        self.inner.persist(&e);
        Ok(e.info())
    }

    pub fn record(&self, id: &str) -> Option<DownloadRecord> {
        self.get(id).ok().map(|e| e.snapshot())
    }

    /// Mark a download completed (used for testing state machine / scheduler).
    pub fn mark_completed_for_test(&self, id: &str) {
        if let Ok(e) = self.get(id) {
            self.inner.set_state(&e, DownloadState::Completed, None);
        }
    }

    /// Resume a paused, waiting or failed download (a cancelled one starts over).
    pub async fn resume(&self, id: &str) -> Result<(), EngineError> {
        let e = self.get(id)?;
        match e.state() {
            s if s.is_active() => Ok(()),
            DownloadState::Completed => {
                Err(EngineError::InvalidState("This download has already finished.".into()))
            }
            _ => {
                self.stop(&e, REASON_NONE).await; // reap a finished run, if any
                self.start_run(&e).await;
                Ok(())
            }
        }
    }

    /// Give an expired download a fresh link for the **same file**. The new link is probed and must
    /// have the same size (and ETag / Last-Modified when the server provides them); the download then
    /// continues from where it stopped.
    pub async fn refresh_link(&self, id: &str, new_url: &str) -> Result<(), EngineError> {
        let e = self.get(id)?;
        if e.state().is_active() || e.state() == DownloadState::Completed {
            return Err(EngineError::InvalidState("This download can't take a new link right now.".into()));
        }
        let url = Url::parse(new_url.trim())?;
        policy::check_url(&url)?;
        let rec = e.snapshot();
        let session = HttpSession::new(&rec.http, &url);
        let p = probe::probe(&session, &url).await?;
        if rec.total_size.is_some() && (validators_changed(&rec, &p) || (rec.has_resumable_progress() && !p.accepts_ranges)) {
            return Err(EngineError::InvalidOption(
                "That link leads to a different file (its size or version doesn't match), so the download can't continue from it."
                    .into(),
            ));
        }
        e.with(|r| {
            r.url = url.to_string();
            r.final_url = Some(p.final_url.to_string());
        });
        self.resume(id).await
    }

    /// Stop and throw the partial file away. The entry stays in the list as *Cancelled*.
    pub async fn cancel(&self, id: &str) -> Result<(), EngineError> {
        let e = self.get(id)?;
        if e.state() == DownloadState::Completed {
            return Err(EngineError::InvalidState(
                "This download has already finished. Use Remove to delete it.".into(),
            ));
        }
        self.stop(&e, REASON_CANCEL).await;
        if e.state() != DownloadState::Cancelled {
            finish_cancel(&self.inner, &e).await;
        }
        Ok(())
    }

    /// Throw away everything downloaded so far and start again from byte 0.
    pub async fn restart(&self, id: &str) -> Result<(), EngineError> {
        let e = self.get(id)?;
        self.stop(&e, REASON_CANCEL).await;
        delete_partial_file(&e).await;
        e.with(|r| r.reset_progress());
        self.start_run(&e).await;
        Ok(())
    }

    /// Remove from the list. An unfinished download's partial file is always deleted; a finished
    /// file is only deleted when `delete_file` is true.
    pub async fn remove(&self, id: &str, delete_file: bool) -> Result<(), EngineError> {
        let e = self.get(id)?;
        self.stop(&e, REASON_CANCEL).await;
        if e.state() != DownloadState::Completed || delete_file {
            delete_partial_file(&e).await;
        }
        self.inner.entries.lock().unwrap().remove(id);
        self.inner.send(EngineEvent::Removed(id.to_string()));
        Ok(())
    }

    // ---- internals ------------------------------------------------------------------------

    async fn start_run(&self, entry: &Arc<Entry>) {
        let cancel = CancellationToken::new();
        let reason = Arc::new(AtomicU8::new(REASON_NONE));
        self.inner.set_state(entry, DownloadState::Probing, None);
        let join = tokio::spawn(run_task(self.inner.clone(), entry.clone(), cancel.clone(), reason.clone()));
        *entry.run.lock().await = Some(RunHandle { cancel, reason, join });
    }

    /// Tell the running task (if any) to stop, and wait until it has fully wound down
    /// (all buffered data written, state updated).
    async fn stop(&self, entry: &Arc<Entry>, reason: u8) {
        let handle = entry.run.lock().await.take();
        if let Some(h) = handle {
            h.reason.store(reason, Ordering::SeqCst);
            h.cancel.cancel();
            let _ = h.join.await;
        }
    }
}

async fn delete_partial_file(entry: &Entry) {
    if let Some(p) = entry.with(|r| r.path()) {
        let _ = tokio::fs::remove_file(p).await;
    }
}

async fn finish_cancel(inner: &Inner, entry: &Entry) {
    delete_partial_file(entry).await;
    entry.with(|r| r.reset_progress());
    inner.set_state(entry, DownloadState::Cancelled, None);
}

/// The task that runs one download from probe to completion.
async fn run_task(inner: Arc<Inner>, entry: Arc<Entry>, cancel: CancellationToken, reason: Arc<AtomicU8>) {
    let outcome = execute(&inner, &entry, &cancel).await;
    let reason = reason.load(Ordering::SeqCst);
    if reason == REASON_CANCEL {
        finish_cancel(&inner, &entry).await;
        return;
    }
    match outcome {
        Ok(Outcome::Completed) => {
            entry.with(|r| {
                r.completed_at = Some(now_secs());
                if let Some(t) = r.total_size {
                    r.downloaded = t;
                }
            });
            inner.set_state(&entry, DownloadState::Completed, None);
        }
        Ok(Outcome::Stopped) | Err(EngineError::Stopped) => {
            let state = if reason == REASON_NETWORK { DownloadState::WaitingForNetwork } else { DownloadState::Paused };
            inner.set_state(&entry, state, None);
        }
        Err(EngineError::LinkExpired) => {
            inner.set_state(&entry, DownloadState::LinkExpired, Some(EngineError::LinkExpired.to_user_error()));
        }
        // A network error while the internet is known to be down is not a failure: wait for it.
        Err(e) if e.retry_class() == RetryClass::Network && !inner.net.is_online() => {
            inner.set_state(&entry, DownloadState::WaitingForNetwork, None);
        }
        Err(e) => inner.set_state(&entry, DownloadState::Failed, Some(e.to_user_error())),
    }
}

/// Did the file change on the server since we started?
fn validators_changed(rec: &DownloadRecord, p: &ProbeResult) -> bool {
    if let (Some(a), Some(b)) = (&rec.etag, &p.etag) {
        if a != b {
            return true;
        }
    } else if let (Some(a), Some(b)) = (&rec.last_modified, &p.last_modified) {
        if a != b {
            return true;
        }
    }
    matches!((rec.total_size, p.total_size), (Some(a), Some(b)) if a != b)
}

/// Choose and reserve the destination path (once per download).
fn ensure_path(inner: &Inner, entry: &Entry, name: &str) -> Result<PathBuf, EngineError> {
    if let Some(p) = entry.with(|r| r.path()) {
        return Ok(p); // chosen by an earlier attempt
    }
    let dir = PathBuf::from(entry.with(|r| r.save_dir.clone()));
    std::fs::create_dir_all(&dir)?;
    // Hold the map lock so two downloads of the same name cannot pick the same path.
    let map = inner.entries.lock().unwrap();
    let taken: HashSet<PathBuf> = map
        .values()
        .filter(|e| e.id != entry.id)
        .filter_map(|e| e.record.lock().ok().and_then(|r| r.path()))
        .collect();
    let path = filename::unique_path(&dir, name, &|p| taken.contains(p));
    entry.with(|r| {
        r.file_path = path.to_string_lossy().to_string();
        r.file_name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| name.to_string());
    });
    Ok(path)
}

/// Copy the live table into the record (what the UI and the next checkpoint see).
fn apply_table(r: &mut DownloadRecord, segs: Vec<Segment>) {
    r.downloaded = segments::total_downloaded(&segs);
    r.segments = segs;
}

/// Durable checkpoint: snapshot, fsync, then persist (in that order; see module docs).
async fn checkpoint(inner: &Inner, entry: &Entry, file: &OffsetFile, table: &SegmentTable) {
    let snap = table.snapshot();
    let f = file.clone();
    // fsync can take seconds on a busy disk, so it runs on a blocking thread, and periodic
    // checkpoints run in their own task so progress reporting never waits on it.
    let synced = tokio::task::spawn_blocking(move || f.sync()).await;
    if !matches!(synced, Ok(Ok(()))) {
        return; // could not make the data durable, so do not claim it
    }
    // Apply the (older) snapshot to a *copy*: the live record keeps the newer in-memory progress.
    let mut rec = entry.snapshot();
    apply_table(&mut rec, snap);
    inner.send(EngineEvent::Persist(Box::new(rec)));
}

/// Speed and totals per network adapter, only while Turbo Mode is actually bonding networks.
fn adapter_progress(set: &AdapterSet, meters: &mut [SpeedMeter]) -> Vec<AdapterProgress> {
    let now = std::time::Instant::now();
    let mut out = Vec::new();
    for (slot, meter) in set.slots.iter().zip(meters.iter_mut()) {
        let bytes = slot.bytes.load(Ordering::Relaxed);
        let speed = meter.sample(bytes, now);
        if set.is_bonded() {
            out.push(AdapterProgress {
                id: slot.info.id.clone(),
                name: slot.info.name.clone(),
                kind: slot.info.kind,
                ip: slot.info.ip.to_string(),
                speed_bps: speed as u64,
                bytes,
                connections: slot.active() as u32,
            });
        }
    }
    out
}

#[allow(clippy::too_many_arguments)]
fn emit_progress(
    inner: &Inner,
    entry: &Entry,
    table: &SegmentTable,
    meter: &mut SpeedMeter,
    note: Option<String>,
    protocol: Option<&'static str>,
    connections: u32,
    adapters: Vec<AdapterProgress>,
) {
    let snap = table.snapshot();
    let (segments, downloaded, total) = entry.with(|r| {
        apply_table(r, snap);
        (r.segments.iter().map(SegmentProgress::from).collect::<Vec<_>>(), r.downloaded, r.total_size)
    });
    let speed = meter.sample(downloaded, std::time::Instant::now());
    let eta = total.and_then(|t| progress::eta_secs(t.saturating_sub(downloaded), speed));
    {
        let mut live = entry.live.lock().unwrap();
        live.speed = speed as u64;
        live.eta = eta;
        live.note = note.clone();
        live.protocol = protocol.map(str::to_string);
    }
    inner.send(EngineEvent::Progress(ProgressEvent {
        id: entry.id.clone(),
        downloaded,
        total,
        speed_bps: speed as u64,
        eta_secs: eta,
        segments,
        note,
        protocol: protocol.map(str::to_string),
        connections,
        adapters,
    }));
}

/// Wait `d`, or until cancelled. Returns `true` if cancelled.
async fn sleep_or_cancel(d: Duration, cancel: &CancellationToken) -> bool {
    tokio::select! {
        _ = cancel.cancelled() => true,
        _ = tokio::time::sleep(d) => false,
    }
}

/// Probe, retrying network and server errors a few times (a flaky moment should not fail a
/// download that has never started). Permanent errors (404, bad link, ...) fail right away.
async fn probe_with_retry(
    inner: &Inner,
    session: &HttpSession,
    url: &Url,
    cancel: &CancellationToken,
    retry: &RetryPolicy,
) -> Result<ProbeResult, EngineError> {
    let mut attempt = 0u32;
    loop {
        let result = tokio::select! {
            _ = cancel.cancelled() => return Err(EngineError::Stopped),
            r = probe::probe(session, url) => r,
        };
        let err = match result {
            Ok(p) => return Ok(p),
            Err(e) => e,
        };
        let class = err.retry_class();
        if !matches!(class, RetryClass::Network | RetryClass::Server) || attempt >= retry.max_probe_retries {
            return Err(err);
        }
        attempt += 1;
        if class == RetryClass::Network {
            inner.net.request_check(); // is the whole internet down?
        }
        let delay = retry.delay(attempt);
        let cancelled = tokio::select! {
            _ = cancel.cancelled() => true,
            _ = inner.net.sleep_until_up(delay) => false,
        };
        if cancelled {
            return Err(EngineError::Stopped);
        }
    }
}

/// Per-run state shared by all phases of one `execute`.
struct RunState {
    /// Connections we try to keep busy. Halved when connections keep failing, grown by AIMD.
    target: u32,
    initial_target: u32,
    halved: bool,
    last_halve: Option<std::time::Instant>,
    /// Shown to the user while it applies, e.g. "The server limits connections: using 4".
    note: Option<String>,
    /// AIMD: the most connections this download may use.
    ceiling: u32,
    /// AIMD: when the speed was last compared, and what it was.
    grow_checked_at: std::time::Instant,
    grow_last_speed: f64,
    /// AIMD has found the count that works (the ceiling was reached, or the last extra connection
    /// brought no real gain). Only then is the count remembered for the domain: a download that
    /// ended while still ramping up says nothing about the best count.
    settled: bool,
}

enum PhaseEnd {
    Complete,
    Stopped,
}

/// Probe, plan, download, verify.
async fn execute(inner: &Arc<Inner>, entry: &Arc<Entry>, cancel: &CancellationToken) -> Result<Outcome, EngineError> {
    let rec = entry.snapshot();
    let url = Url::parse(&rec.url)?;
    policy::check_url(&url)?;
    let cfg = inner.cfg.lock().unwrap().clone();
    let session = Arc::new(HttpSession::new(&rec.http, &url));

    // ---- 1. Probe ---------------------------------------------------------------------------
    let probed = match probe_with_retry(inner, &session, &url, cancel, &cfg.retry).await {
        Ok(p) => p,
        // A link that worked before and is now refused has probably expired.
        Err(EngineError::Http(403 | 410)) if rec.downloaded > 0 || rec.final_url.is_some() => {
            return Err(EngineError::LinkExpired)
        }
        Err(e) => return Err(e),
    };

    // ---- 2. Resume or start fresh ------------------------------------------------------------
    let mut resuming = false;
    if rec.has_resumable_progress() {
        let total = rec.total_size.unwrap_or(0);
        let file_ok = match rec.path() {
            Some(p) => tokio::fs::metadata(&p).await.map(|m| m.len() == total).unwrap_or(false),
            None => false,
        };
        if file_ok && segments::is_consistent(&rec.segments, total) {
            if validators_changed(&rec, &probed) {
                return Err(EngineError::FileChanged);
            }
            if !probed.accepts_ranges {
                return Err(EngineError::RangeIgnored);
            }
            resuming = true;
        }
        // Otherwise the partial file is gone or damaged: quietly start over.
    }

    let (file, total, ranged): (OffsetFile, Option<u64>, bool) = if resuming {
        let total = rec.total_size.unwrap_or(0);
        let path = rec.path().ok_or_else(|| EngineError::Other("missing file path".into()))?;
        let file = OffsetFile::open_existing(&path, total)?;
        entry.with(|r| r.final_url = Some(probed.final_url.to_string()));
        (file, Some(total), true)
    } else {
        let name = if rec.file_name_locked { rec.file_name.clone() } else { probed.file_name.clone() };
        let path = ensure_path(inner, entry, &name)?;
        let total = probed.total_size;
        let ranged = probed.accepts_ranges && total.is_some_and(|t| t > 0);
        let plan = if ranged {
            segments::split(total.unwrap_or(0), rec.connections)
        } else if total == Some(0) {
            Vec::new()
        } else {
            vec![segments::single(total)]
        };
        // Pre-allocate the full file now (when the size is known): fails early if the disk is full.
        let file = OffsetFile::create(&path, total)?;
        entry.with(|r| {
            r.final_url = Some(probed.final_url.to_string());
            r.mime = probed.mime.clone();
            r.etag = probed.etag.clone();
            r.last_modified = probed.last_modified.clone();
            r.total_size = total;
            r.resume_supported = Some(ranged);
            r.segments = plan;
            r.downloaded = 0;
            r.checksum_verified = None;
        });
        (file, total, ranged)
    };

    // HTTP/3: remember what the server advertises (Alt-Svc) and how we may use it. A website that
    // recently failed over QUIC goes straight to TCP (unless HTTP/3 is being forced).
    let origin = H3Memory::origin_key(&probed.final_url);
    let plan = if cfg.http3 == H3Plan::Auto && inner.h3_memory.is_bad(&origin) { H3Plan::Off } else { cfg.http3 };
    session.configure_h3(plan, probed.h3_port);
    // Mirrors: verify each one against the primary (same size and ETag) before trusting it.
    let mirrors = prepare_mirrors(inner, entry, &cfg, &rec, &probed, ranged, cancel).await;

    inner.set_state(entry, DownloadState::Downloading, None);

    // ---- 3. Download (in phases: a phase ends when the link has to be refreshed) --------------
    let started = std::time::Instant::now();
    let written_at_start = entry.with(|r| segments::total_downloaded(&r.segments));
    let initial_segments = entry.with(|r| r.segments.len()) as u32;
    // AIMD: the download's connection count is the ceiling. It starts lower (4, or the count that
    // worked best for this website last time) and adds one connection per `aimd_interval` while the
    // total speed keeps improving. Single-stream downloads and servers without ranges skip this.
    let ceiling = rec.connections.clamp(MIN_CONNECTIONS, MAX_CONNECTIONS);
    let remembered = domain_of(&probed.final_url).and_then(|d| inner.hints.lock().unwrap().get(&d).map(|h| h.connections));
    let start = match remembered {
        Some(best) => best.clamp(MIN_CONNECTIONS, ceiling),
        None if ranged && cfg.aimd_start > 0 => cfg.aimd_start.clamp(MIN_CONNECTIONS, ceiling),
        None => ceiling,
    };
    let mut run = RunState {
        target: if ranged { start } else { ceiling },
        initial_target: rec.connections,
        halved: false,
        last_halve: None,
        note: None,
        ceiling,
        grow_checked_at: std::time::Instant::now(),
        grow_last_speed: 0.0,
        // Nothing to ramp: started at the ceiling, or not ranged.
        settled: !ranged || start >= ceiling,
    };
    let mut url_now = probed.final_url.clone();
    let mut refreshes = 0u32;
    // `transfer_time` is when the last byte arrived. The final fsync / verification are disk work,
    // and a stalled disk must not be mistaken for a slow server when learning the best
    // connection count.
    let transfer_time = loop {
        match run_phase(inner, entry, cancel, &cfg, &session, &mirrors, &file, ranged, total, &url_now, &mut run).await {
            Ok(PhaseEnd::Complete) => break started.elapsed(),
            Ok(PhaseEnd::Stopped) => return Ok(Outcome::Stopped),
            Err(EngineError::LinkExpired) => {
                // The server refused our (probably signed) link. Ask the original address for a
                // fresh one and carry on from the saved progress.
                refreshes += 1;
                if refreshes > cfg.max_refresh_attempts {
                    return Err(EngineError::LinkExpired);
                }
                url_now = refresh_link_url(inner, entry, &session, &url, cancel, &cfg, refreshes).await?;
            }
            Err(e) => return Err(e),
        }
    };

    // ---- 4. Verify size ---------------------------------------------------------------------
    let segs_now = entry.with(|r| r.segments.clone());
    let written = segments::total_downloaded(&segs_now);
    match total {
        Some(expected) => {
            let incomplete = segments::incomplete(&segs_now).count();
            if written != expected || incomplete != 0 || file.len()? != expected {
                return Err(EngineError::SizeMismatch { expected, actual: written });
            }
        }
        None => {
            // Unknown length: whatever arrived is the file.
            file.set_len(written)?;
            entry.with(|r| r.total_size = Some(written));
        }
    }
    file.sync()?;

    // ---- 5. Optional checksum ---------------------------------------------------------------
    if let Some(expected) = entry.with(|r| r.checksum.clone()) {
        inner.set_state(entry, DownloadState::Verifying, None);
        let path = entry.with(|r| r.path()).ok_or_else(|| EngineError::Other("missing file path".into()))?;
        let token = cancel.clone();
        let algo = expected.algo;
        let actual = tokio::task::spawn_blocking(move || checksum::hash_file(&path, algo, &token))
            .await
            .map_err(|e| EngineError::Other(format!("checksum task crashed: {e}")))??;
        match actual {
            None => return Ok(Outcome::Stopped), // paused / cancelled while verifying
            Some(actual) if actual.eq_ignore_ascii_case(&expected.hex) => {
                entry.with(|r| r.checksum_verified = Some(true));
            }
            Some(actual) => {
                entry.with(|r| r.checksum_verified = Some(false));
                return Err(EngineError::ChecksumMismatch {
                    algo: expected.algo.to_string(),
                    expected: expected.hex,
                    actual,
                });
            }
        }
    }

    // ---- 6. Remember what worked for this website --------------------------------------------
    learn_domain(inner, &url, &run, initial_segments, written.saturating_sub(written_at_start), transfer_time);

    Ok(Outcome::Completed)
}

/// Update the per-domain "best connection count" after a successful download.
fn learn_domain(inner: &Inner, url: &Url, run: &RunState, initial_segments: u32, bytes: u64, elapsed: Duration) {
    let Some(domain) = domain_of(url) else { return };
    let secs = elapsed.as_secs_f64();
    if bytes < MIN_HINT_BYTES || secs < 1.0 {
        return;
    }
    // A small file split into fewer segments than connections says nothing about the server's
    // limits, unless connections were actually cut because of failures.
    let used_full_target = initial_segments >= run.initial_target;
    if !run.halved && !used_full_target {
        return;
    }
    // Still ramping up when the file ended: the count reached says nothing about the best one.
    if !run.halved && !run.settled {
        return;
    }
    let speed = (bytes as f64 / secs) as u64;
    let update = {
        let hints = inner.hints.lock().unwrap();
        merge_hint(hints.get(&domain), &domain, run.target, speed, run.halved)
    };
    if let Some(h) = update {
        inner.hints.lock().unwrap().insert(domain.clone(), h.clone());
        inner.send(EngineEvent::DomainBest(DomainBest { domain, connections: h.connections, speed_bps: h.speed_bps }));
    }
}

/// Is `m` the same file as the primary? Mirrors are only used when this holds, so that bytes
/// from different sources can never be mixed into a corrupt file.
///
/// Required: range support, identical size, and an identical ETag. Servers without an ETag are
/// accepted only if both report the same `Last-Modified`; without any validator we cannot tell
/// whether it is the same version, so the mirror is refused.
fn mirror_matches(primary: &ProbeResult, m: &ProbeResult) -> Result<(), String> {
    if !m.accepts_ranges {
        return Err("it doesn't support partial downloads".into());
    }
    match (primary.total_size, m.total_size) {
        (Some(a), Some(b)) if a == b => {}
        (Some(_), Some(_)) => return Err("it is a different size, so it is a different file".into()),
        _ => return Err("it doesn't report the file size, so it can't be checked".into()),
    }
    match (&primary.etag, &m.etag) {
        (Some(a), Some(b)) if a == b => Ok(()),
        (Some(_), Some(_)) => Err("its version (ETag) is different, so it may be a different file".into()),
        (None, None) => match (&primary.last_modified, &m.last_modified) {
            (Some(a), Some(b)) if a == b => Ok(()),
            _ => Err("neither server provides an ETag, and the modification dates don't match".into()),
        },
        _ => Err("only one of the two servers provides an ETag, so it can't be checked".into()),
    }
}

/// Probe every mirror (in parallel) and keep those that are verifiably the same file.
/// The outcome is recorded in the download for the UI. Mirrors on another origin get no
/// credentials, cookies or credential-like headers (see [`crate::http::HttpOptions::for_mirror`]).
async fn prepare_mirrors(
    inner: &Inner,
    entry: &Entry,
    cfg: &EngineConfig,
    rec: &DownloadRecord,
    primary: &ProbeResult,
    ranged: bool,
    cancel: &CancellationToken,
) -> Vec<(Url, Arc<HttpSession>)> {
    if rec.mirrors.is_empty() {
        entry.with(|r| r.mirror_report.clear());
        return Vec::new();
    }
    if !ranged {
        let report = rec
            .mirrors
            .iter()
            .map(|m| MirrorReport {
                url: m.clone(),
                ok: false,
                reason: Some("the main link can't be split into parts, so mirrors can't be used".into()),
            })
            .collect();
        entry.with(|r| r.mirror_report = report);
        inner.emit_updated(entry);
        return Vec::new();
    }

    let timeout = cfg.mirror_probe_timeout;
    let probes = rec.mirrors.iter().cloned().map(|m| {
        let opts = rec.http.clone();
        let primary_url = primary.final_url.clone();
        async move {
            let Ok(url) = Url::parse(&m) else { return (m, Err("it isn't a valid link".to_string())) };
            let session = Arc::new(HttpSession::new(&opts.for_mirror(&primary_url, &url), &url));
            match tokio::time::timeout(timeout, probe::probe(&session, &url)).await {
                Err(_) => (m, Err("it didn't answer in time".to_string())),
                Ok(Err(e)) => (m, Err(e.user_message())),
                Ok(Ok(p)) => (m, Ok((session, p))),
            }
        }
    });
    let results = tokio::select! {
        _ = cancel.cancelled() => return Vec::new(),
        r = futures_util::future::join_all(probes) => r,
    };

    let mut report = Vec::new();
    let mut usable = Vec::new();
    for (m, r) in results {
        match r.and_then(|(session, p)| mirror_matches(primary, &p).map(|()| (session, p))) {
            Ok((session, p)) => {
                session.configure_h3(cfg.http3, p.h3_port);
                usable.push((p.final_url.clone(), session));
                report.push(MirrorReport { url: m, ok: true, reason: None });
            }
            Err(reason) => report.push(MirrorReport { url: m, ok: false, reason: Some(reason) }),
        }
    }
    entry.with(|r| r.mirror_report = report);
    inner.emit_updated(entry);
    usable
}

/// Re-probe the original address to obtain a fresh download link for the same file.
async fn refresh_link_url(
    inner: &Inner,
    entry: &Entry,
    session: &HttpSession,
    original: &Url,
    cancel: &CancellationToken,
    cfg: &EngineConfig,
    attempt: u32,
) -> Result<Url, EngineError> {
    if sleep_or_cancel(cfg.retry.delay(attempt), cancel).await {
        return Err(EngineError::Stopped);
    }
    let rec = entry.snapshot();
    let probed = tokio::select! {
        _ = cancel.cancelled() => return Err(EngineError::Stopped),
        r = probe::probe(session, original) => r,
    };
    match probed {
        Ok(p) => {
            if validators_changed(&rec, &p) || !p.accepts_ranges {
                // Whatever is at that address now is not the file we were downloading.
                return Err(EngineError::LinkExpired);
            }
            entry.with(|r| r.final_url = Some(p.final_url.to_string()));
            inner.emit_updated(entry);
            Ok(p.final_url)
        }
        // Still refused / unreachable: let the caller count the attempt and try again.
        Err(EngineError::Http(403 | 410) | EngineError::LinkExpired) => Err(EngineError::LinkExpired),
        Err(e) => Err(e),
    }
}

/// Start workers until `target` connections are busy: first on segments that have no connection,
/// then (work stealing) by splitting the slowest one.
fn fill_workers(
    ctx: &WorkerCtx,
    set: &mut JoinSet<Result<WorkerExit, EngineError>>,
    active: &mut usize,
    target: usize,
    steal: Option<u64>,
) {
    while *active < target {
        let seg = match ctx.table.next_unstarted() {
            Some(s) => s,
            None => match steal.and_then(|min| ctx.table.steal(min)) {
                Some(s) => s,
                None => break, // nothing left to hand out
            },
        };
        set.spawn(run_segment(ctx.clone(), seg));
        *active += 1;
    }
}

/// Monitor-side bookkeeping for one segment's connection.
struct Watch {
    last_rx: u64,
    last_at: std::time::Instant,
    /// Table time when the current connection was first seen running.
    running_since: Option<u64>,
    /// Table time since which the connection has been below the slow threshold.
    slow_since: Option<u64>,
    restarts: u32,
}

/// Refresh per-segment speeds (moving average), and close connections that have stalled.
fn watch_connections(
    table: &SegmentTable,
    watches: &mut HashMap<u32, Watch>,
    cfg: &EngineConfig,
    detect_stalls: bool,
) {
    const ALPHA: f64 = 0.3;
    let now = std::time::Instant::now();
    let now_ms = table.now_ms();
    let segs = table.all();

    // 1. speeds
    for s in &segs {
        let w = watches.entry(s.id).or_insert_with(|| Watch {
            last_rx: s.rx_total(),
            last_at: now,
            running_since: None,
            slow_since: None,
            restarts: 0,
        });
        if !s.is_running() {
            w.running_since = None;
            w.slow_since = None;
            s.set_speed(0);
            continue;
        }
        if w.running_since.is_none() {
            w.running_since = Some(now_ms);
            w.last_rx = s.rx_total();
            w.last_at = now;
            continue;
        }
        let dt = now.duration_since(w.last_at).as_secs_f64();
        if dt > 0.0 {
            let rx = s.rx_total();
            let inst = rx.saturating_sub(w.last_rx) as f64 / dt;
            let prev = s.speed() as f64;
            s.set_speed(if prev == 0.0 { inst } else { ALPHA * inst + (1.0 - ALPHA) * prev } as u64);
            w.last_rx = rx;
            w.last_at = now;
        }
    }
    if !detect_stalls {
        return;
    }

    // 2. stalls
    let zero_ms = cfg.stall_zero_after.as_millis() as u64;
    let slow_ms = cfg.stall_slow_after.as_millis() as u64;
    // A new connection needs a moment to ramp up before its speed means anything.
    let warmup_ms = (slow_ms / 2).min(2000);

    let live: Vec<_> = segs
        .iter()
        .filter(|s| s.is_running() && !s.is_exempt())
        .filter(|s| watches.get(&s.id).and_then(|w| w.running_since).is_some_and(|t| now_ms.saturating_sub(t) >= warmup_ms))
        .collect();
    let avg = if live.is_empty() { 0 } else { live.iter().map(|s| s.speed()).sum::<u64>() / live.len() as u64 };

    for s in &segs {
        let Some(w) = watches.get_mut(&s.id) else { continue };
        if !s.is_running() || s.is_exempt() {
            w.slow_since = None;
            continue;
        }
        let Some(since) = w.running_since else { continue };

        // (a) nothing at all for stall_zero_after
        let idle_ms = now_ms.saturating_sub(s.last_rx_ms());
        let mut stalled = idle_ms >= zero_ms;

        // (b) far below the average of the other connections for stall_slow_after
        if !stalled && live.len() >= 2 && now_ms.saturating_sub(since) >= warmup_ms && avg > 0 {
            if (s.speed() as f64) < cfg.stall_slow_ratio * avg as f64 {
                let from = *w.slow_since.get_or_insert(now_ms);
                stalled = now_ms.saturating_sub(from) >= slow_ms;
            } else {
                w.slow_since = None;
            }
        }

        if stalled {
            w.restarts += 1;
            w.slow_since = None;
            w.running_since = None;
            // Repeated stalls on the same segment: wait a little longer each time.
            let delay = if w.restarts >= 3 { ((w.restarts - 2) as u64 * 1000).min(10_000) } else { 0 };
            s.set_not_before(now_ms + delay);
            s.abort_connection(); // the worker returns `Aborted`; the segment is reopened by `fill_workers`
        } else if w.slow_since.is_none() && now_ms.saturating_sub(since) > 5_000 {
            w.restarts = 0; // healthy for a while
        }
    }
}

/// AIMD, the additive half: every `aimd_interval`, if the total speed is more than `aimd_gain`
/// (5 %) above what it was at the previous comparison, allow one more connection (up to the
/// download's ceiling). When an interval brings no real gain the count has settled, and it stays.
///
/// `speed` is the smoothed total speed in bytes/s.
fn maybe_grow(inner: &Inner, entry: &Entry, cfg: &EngineConfig, run: &mut RunState, speed: f64) {
    if run.target >= run.ceiling {
        run.settled = true;
        return;
    }
    if run.grow_checked_at.elapsed() < cfg.aimd_interval {
        return;
    }
    let previous = std::mem::replace(&mut run.grow_last_speed, speed);
    run.grow_checked_at = std::time::Instant::now();
    if speed > 0.0 && speed > previous * (1.0 + cfg.aimd_gain) {
        run.target += 1;
        run.settled = run.target >= run.ceiling;
        inner.emit_updated(entry);
    } else if previous > 0.0 {
        // The last connection added (or the start) brought no real improvement: stop here.
        run.settled = true;
    }
}

/// If connections keep failing while the internet is up, halve the connection count.
fn maybe_halve(
    inner: &Inner,
    entry: &Entry,
    table: &SegmentTable,
    fails: &FailLog,
    cfg: &EngineConfig,
    run: &mut RunState,
) {
    if run.target <= 1 || !inner.net.is_online() {
        return;
    }
    // 429 / 503 is the server explicitly asking for fewer connections: one is enough. Other
    // failures must pile up (`fail_threshold` within `fail_window`).
    let throttled = fails.take_throttle();
    if run.last_halve.is_some_and(|t| t.elapsed() < cfg.halve_cooldown) {
        return;
    }
    if !throttled && fails.count_within(cfg.fail_window) < cfg.fail_threshold {
        return;
    }
    run.target = (run.target / 2).max(1);
    run.halved = true;
    // Multiplicative decrease, then no probing back up for the rest of this run: the server just
    // told us where its limit is, and growing again would only walk into it a second time.
    run.ceiling = run.target;
    run.settled = true;
    run.last_halve = Some(std::time::Instant::now());
    run.note = Some(format!("The server keeps refusing connections: now using {}", run.target));
    fails.clear();
    // Persisted on purpose: the server's limit also applies after a pause / resume.
    entry.with(|r| r.connections = run.target);
    inner.emit_updated(entry);

    // Close the slowest surplus connections. Their segments keep their progress and are picked
    // up again by the remaining connections.
    let mut running: Vec<_> = table.all().into_iter().filter(|s| s.is_running()).collect();
    running.sort_by_key(|s| s.speed());
    let surplus = running.len().saturating_sub(run.target as usize);
    for s in running.into_iter().take(surplus) {
        s.abort_connection();
    }
}

/// One stretch of downloading with a fixed URL. Ends when everything is downloaded, the user
/// stops it, an error occurs, or the link has to be refreshed (`Err(LinkExpired)`).
#[allow(clippy::too_many_arguments)]
async fn run_phase(
    inner: &Arc<Inner>,
    entry: &Arc<Entry>,
    cancel: &CancellationToken,
    cfg: &EngineConfig,
    session: &Arc<HttpSession>,
    mirrors: &[(Url, Arc<HttpSession>)],
    file: &OffsetFile,
    ranged: bool,
    total: Option<u64>,
    url: &Url,
    run: &mut RunState,
) -> Result<PhaseEnd, EngineError> {
    let _ = total;
    let plan = entry.with(|r| r.segments.clone());
    let table = Arc::new(SegmentTable::new(&plan, ranged));
    let worker_cancel = cancel.child_token();
    let retrying = Arc::new(AtomicU32::new(0));
    let fails = Arc::new(FailLog::default());
    let protocol = Arc::new(AtomicU8::new(0));
    // The primary link first, then the verified mirrors: connections are spread over all of them.
    let mut source_list = vec![(url.clone(), session.clone())];
    source_list.extend(mirrors.iter().cloned());
    // Turbo Mode: the adapters connections may be bound to. Detected per run (cheap); only used while
    // the switch is on and at least two networks are up.
    let adapter_list = cfg.adapter_override.clone().unwrap_or_else(adapters::detect);
    let adapter_set = Arc::new(AdapterSet::new(adapter_list, inner.turbo.clone()));
    let ctx = WorkerCtx {
        sources: Arc::new(SourceSet::new(source_list)),
        adapters: adapter_set.clone(),
        writer: DiskWriter::spawn(file.clone()),
        validator: entry.snapshot().validator(),
        global_limiter: inner.global.clone(),
        dl_limiter: entry.limiter.clone(),
        cancel: worker_cancel.clone(),
        table: table.clone(),
        retrying: retrying.clone(),
        retry: cfg.retry,
        net: inner.net.clone(),
        fails: fails.clone(),
        protocol: protocol.clone(),
    };
    let steal = (cfg.work_stealing && ranged).then_some(cfg.min_steal_size);

    let mut set: JoinSet<Result<WorkerExit, EngineError>> = JoinSet::new();
    let mut active = 0usize;
    let target_of = |run: &RunState| if ranged { run.target as usize } else { 1 };
    fill_workers(&ctx, &mut set, &mut active, target_of(run), steal);

    let mut ticker = tokio::time::interval(cfg.progress_interval);
    ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut meter = SpeedMeter::new(table.total_written(), std::time::Instant::now());
    let mut adapter_meters: Vec<SpeedMeter> =
        adapter_set.slots.iter().map(|_| SpeedMeter::new(0, std::time::Instant::now())).collect();
    let mut last_checkpoint = tokio::time::Instant::now();
    // At most one periodic checkpoint is in flight; a slow disk just lengthens the interval.
    let mut checkpoint_task: Option<JoinHandle<()>> = None;
    let mut failure: Option<EngineError> = None;
    let mut watches: HashMap<u32, Watch> = HashMap::new();

    loop {
        let healthy = failure.is_none() && !worker_cancel.is_cancelled();
        if set.is_empty() {
            // Nothing running. Done if everything is complete (or we are stopping); otherwise
            // some segment is waiting out a restart delay: the next tick starts it.
            let all_done = table.all().iter().all(|s| s.is_complete());
            if !healthy || all_done {
                break;
            }
        }
        tokio::select! {
            _ = ticker.tick() => {
                watch_connections(&table, &mut watches, cfg, healthy && ranged);
                if healthy {
                    if ranged {
                        maybe_halve(inner, entry, &table, &fails, cfg, run);
                        let speed = entry.live.lock().unwrap().speed as f64;
                        maybe_grow(inner, entry, cfg, run, speed);
                    }
                    fill_workers(&ctx, &mut set, &mut active, target_of(run), steal);
                }
                let note = if retrying.load(Ordering::SeqCst) > 0 {
                    Some("Connection problem, reconnecting...".to_string())
                } else {
                    run.note.clone()
                };
                let adapters_now = adapter_progress(&adapter_set, &mut adapter_meters);
                emit_progress(inner, entry, &table, &mut meter, note, protocol_name(protocol.load(Ordering::SeqCst)), run.target, adapters_now);
                let idle = checkpoint_task.as_ref().is_none_or(|h| h.is_finished());
                if idle && last_checkpoint.elapsed() >= cfg.checkpoint_interval {
                    let (inner, entry, file, table) = (inner.clone(), entry.clone(), file.clone(), table.clone());
                    checkpoint_task = Some(tokio::spawn(async move {
                        checkpoint(&inner, &entry, &file, &table).await;
                    }));
                    last_checkpoint = tokio::time::Instant::now();
                }
            }
            joined = set.join_next(), if !set.is_empty() => match joined {
                None => {}
                Some(Ok(res)) => {
                    active = active.saturating_sub(1);
                    match res {
                        Ok(WorkerExit::Finished | WorkerExit::Stopped | WorkerExit::Aborted) => {}
                        Err(e) => {
                            if failure.is_none() {
                                failure = Some(e);
                                worker_cancel.cancel(); // stop the siblings; they flush before returning
                            }
                        }
                    }
                    if failure.is_none() && !worker_cancel.is_cancelled() {
                        // A connection just freed up: never leave it idle while work remains.
                        fill_workers(&ctx, &mut set, &mut active, target_of(run), steal);
                    }
                }
                Some(Err(join_err)) => {
                    active = active.saturating_sub(1);
                    if failure.is_none() {
                        failure = Some(EngineError::Other(format!("internal error: {join_err}")));
                        worker_cancel.cancel();
                    }
                }
            }
        }
    }

    // What did we learn about QUIC for this website? Remember it for the next download.
    let origin = H3Memory::origin_key(url);
    if session.h3_broken() {
        inner.h3_memory.mark_bad(origin);
    } else if session.h3_working() {
        inner.h3_memory.clear(&origin);
    }

    // All workers are done and have flushed their buffers. Let any periodic checkpoint finish
    // first (so persisted events stay in order), then record exactly what is on disk.
    if let Some(h) = checkpoint_task.take() {
        let _ = h.await;
    }
    let adapters_now = adapter_progress(&adapter_set, &mut adapter_meters);
    emit_progress(inner, entry, &table, &mut meter, None, protocol_name(protocol.load(Ordering::SeqCst)), run.target, adapters_now);
    checkpoint(inner, entry, file, &table).await;

    if let Some(e) = failure {
        return Err(e);
    }
    if cancel.is_cancelled() {
        return Ok(PhaseEnd::Stopped);
    }
    Ok(PhaseEnd::Complete)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hint(conns: u32, speed: u64) -> DomainHint {
        DomainHint { domain: "example.com".into(), connections: conns, speed_bps: speed }
    }

    #[test]
    fn first_result_is_remembered() {
        let h = merge_hint(None, "example.com", 8, 5_000_000, false).unwrap();
        assert_eq!((h.connections, h.speed_bps), (8, 5_000_000));
    }

    #[test]
    fn clearly_faster_result_replaces_the_memory() {
        let old = hint(4, 2_000_000);
        let h = merge_hint(Some(&old), "example.com", 8, 4_000_000, false).unwrap();
        assert_eq!(h.connections, 8);
    }

    #[test]
    fn similar_speed_with_fewer_connections_wins() {
        let old = hint(16, 5_000_000);
        let h = merge_hint(Some(&old), "example.com", 8, 5_100_000, false).unwrap();
        assert_eq!(h.connections, 8, "same speed for half the connections is better");
        // But similar speed with MORE connections changes nothing.
        let old = hint(8, 5_000_000);
        assert!(merge_hint(Some(&old), "example.com", 16, 5_100_000, false).is_none());
    }

    #[test]
    fn slower_or_marginally_faster_results_do_not_replace() {
        let old = hint(8, 5_000_000);
        // Slower with fewer connections: not "about as fast", keep what worked.
        assert!(merge_hint(Some(&old), "example.com", 4, 2_000_000, false).is_none());
        // 8 % faster with more connections is within noise: keep the lighter setting.
        assert!(merge_hint(Some(&old), "example.com", 12, 5_400_000, false).is_none());
        // 26 % faster is real.
        let h = merge_hint(Some(&old), "example.com", 12, 6_300_000, false).unwrap();
        assert_eq!(h.connections, 12);
    }

    #[test]
    fn equal_speed_never_drifts_towards_more_connections() {
        let old = hint(8, 5_000_000);
        for conns in [9, 12, 16, 32] {
            assert!(merge_hint(Some(&old), "example.com", conns, 5_000_000, false).is_none(), "{conns}");
            assert!(merge_hint(Some(&old), "example.com", conns, 5_200_000, false).is_none(), "{conns}");
        }
    }

    #[test]
    fn a_much_slower_network_refreshes_the_stored_speed() {
        let old = hint(8, 5_000_000);
        let h = merge_hint(Some(&old), "example.com", 8, 1_500_000, false).unwrap();
        assert_eq!((h.connections, h.speed_bps), (8, 1_500_000));
        // A moderately slower run (60 %) is just noise.
        assert!(merge_hint(Some(&old), "example.com", 8, 3_000_000, false).is_none());
    }

    #[test]
    fn forced_reduction_is_always_remembered() {
        // The server kept failing connections, so we ended at 2 even though speed was poor.
        let old = hint(8, 9_000_000);
        let h = merge_hint(Some(&old), "example.com", 2, 500_000, true).unwrap();
        assert_eq!(h.connections, 2);
        // Nothing to report if it is the same count.
        assert!(merge_hint(Some(&hint(2, 500_000)), "example.com", 2, 400_000, true).is_none());
    }

    fn probe_of(size: Option<u64>, etag: Option<&str>, lm: Option<&str>, ranges: bool) -> ProbeResult {
        ProbeResult {
            final_url: Url::parse("https://x.example/f").unwrap(),
            total_size: size,
            accepts_ranges: ranges,
            file_name: "f".into(),
            mime: None,
            etag: etag.map(str::to_string),
            last_modified: lm.map(str::to_string),
            h3_port: None,
        }
    }

    #[test]
    fn a_mirror_must_have_the_same_size_and_etag() {
        let primary = probe_of(Some(1000), Some("\"v1\""), None, true);
        assert!(mirror_matches(&primary, &probe_of(Some(1000), Some("\"v1\""), None, true)).is_ok());
        let e = mirror_matches(&primary, &probe_of(Some(1001), Some("\"v1\""), None, true)).unwrap_err();
        assert!(e.contains("different size"), "{e}");
        let e = mirror_matches(&primary, &probe_of(Some(1000), Some("\"v2\""), None, true)).unwrap_err();
        assert!(e.contains("ETag"), "{e}");
        let e = mirror_matches(&primary, &probe_of(Some(1000), Some("\"v1\""), None, false)).unwrap_err();
        assert!(e.contains("partial"), "{e}");
        let e = mirror_matches(&primary, &probe_of(None, Some("\"v1\""), None, true)).unwrap_err();
        assert!(e.contains("size"), "{e}");
    }

    #[test]
    fn a_mirror_without_a_way_to_verify_it_is_refused() {
        let primary = probe_of(Some(1000), Some("\"v1\""), None, true);
        // Only one side has an ETag: cannot tell whether it is the same version.
        assert!(mirror_matches(&primary, &probe_of(Some(1000), None, Some("d"), true)).is_err());
        // No ETags at all: Last-Modified must agree.
        let p = probe_of(Some(1000), None, Some("Mon"), true);
        assert!(mirror_matches(&p, &probe_of(Some(1000), None, Some("Mon"), true)).is_ok());
        assert!(mirror_matches(&p, &probe_of(Some(1000), None, Some("Tue"), true)).is_err());
        // No validators anywhere: refuse rather than risk mixing versions.
        let none = probe_of(Some(1000), None, None, true);
        assert!(mirror_matches(&none, &probe_of(Some(1000), None, None, true)).is_err());
    }

    #[test]
    fn remembered_count_is_clamped() {
        let h = merge_hint(None, "example.com", 99, 1, false).unwrap();
        assert_eq!(h.connections, MAX_CONNECTIONS);
        let h = merge_hint(None, "example.com", 0, 1, false).unwrap();
        assert_eq!(h.connections, MIN_CONNECTIONS);
    }
}
