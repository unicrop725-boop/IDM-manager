//! End-to-end engine tests against a local HTTP server (see `common/mod.rs`).
//!
//! Run:   cargo test -p flowget-engine --release
//! 1 GB acceptance test (slow):
//!        cargo test -p flowget-engine --release -- --ignored --nocapture acceptance

mod common;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use common::{AuthMode, ServerConfig, TestServer, Trouble, TroubleKind};
use flowget_engine::worker::RetryPolicy;
use flowget_engine::{
    AddRequest, Connectivity, DomainBest, DomainHint, DownloadInfo, DownloadRecord, DownloadState, Engine,
    EngineConfig, EngineEvent, HttpOptions, ProgressEvent,
};
use futures_util::future::BoxFuture;
use tokio::sync::mpsc::UnboundedReceiver;
use tokio::sync::Notify;

const MIB: u64 = 1024 * 1024;
const KIB: u64 = 1024;

// ---------- harness --------------------------------------------------------------------------

#[derive(Default)]
struct Observed {
    /// Latest durable record per download, exactly what the app would have in its database.
    persisted: HashMap<String, DownloadRecord>,
    progress: Vec<ProgressEvent>,
    domain_best: Vec<DomainBest>,
    /// Every state a download passed through, in order (consecutive duplicates removed).
    states: HashMap<String, Vec<DownloadState>>,
}

type Obs = Arc<Mutex<Observed>>;

fn spawn_pump(mut rx: UnboundedReceiver<EngineEvent>, obs: Obs) {
    tokio::spawn(async move {
        while let Some(ev) = rx.recv().await {
            match ev {
                EngineEvent::Persist(r) => {
                    obs.lock().unwrap().persisted.insert(r.id.clone(), *r);
                }
                EngineEvent::Progress(p) => obs.lock().unwrap().progress.push(p),
                EngineEvent::Removed(id) => {
                    obs.lock().unwrap().persisted.remove(&id);
                }
                EngineEvent::Flush(tx) => {
                    let _ = tx.send(());
                }
                EngineEvent::DomainBest(d) => obs.lock().unwrap().domain_best.push(d),
                EngineEvent::Updated(info) => {
                    let mut o = obs.lock().unwrap();
                    let v = o.states.entry(info.id.clone()).or_default();
                    if v.last() != Some(&info.state) {
                        v.push(info.state);
                    }
                }
            }
        }
    });
}

fn test_config(dir: &Path) -> EngineConfig {
    let mut c = EngineConfig::new(dir.to_path_buf());
    c.retry = RetryPolicy {
        max_server_retries: 3,
        max_client_retries: 3,
        max_probe_retries: 4,
        base_delay: Duration::from_millis(20),
        max_delay: Duration::from_millis(200),
        stall_timeout: Duration::from_secs(20),
    };
    c.progress_interval = Duration::from_millis(50);
    c.checkpoint_interval = Duration::from_millis(100);
    c.offline_poll = Duration::from_millis(200);
    // AIMD ramp-up (start at 4, +1 per 2 s) is switched off here so that tests keep fixed connection
    // counts; it has its own tests below.
    c.aimd_start = 0;
    c
}

/// Must be called inside a tokio runtime.
fn make_engine(dir: &Path) -> (Engine, Obs) {
    make_engine_with(test_config(dir))
}

fn make_engine_with(cfg: EngineConfig) -> (Engine, Obs) {
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    let obs: Obs = Arc::new(Mutex::new(Observed::default()));
    spawn_pump(rx, obs.clone());
    (Engine::new(cfg, tx), obs)
}

/// A controllable "internet" for the network supervisor.
struct FakeNet {
    up: AtomicBool,
    changed: Notify,
    /// Whether the OS "network changed" event is delivered (false = the engine must poll).
    events: bool,
}

impl FakeNet {
    fn new(events: bool) -> Arc<Self> {
        Arc::new(Self { up: AtomicBool::new(true), changed: Notify::new(), events })
    }
    fn set(&self, up: bool) {
        self.up.store(up, Ordering::SeqCst);
        if self.events {
            self.changed.notify_one();
        }
    }
}

impl Connectivity for FakeNet {
    fn check(&self) -> BoxFuture<'_, bool> {
        Box::pin(async move { self.up.load(Ordering::SeqCst) })
    }
    fn changed(&self) -> BoxFuture<'_, ()> {
        Box::pin(async move { self.changed.notified().await })
    }
}

/// An engine whose network supervisor is running against `net`.
fn make_engine_with_net(cfg: EngineConfig, net: Arc<FakeNet>) -> (Engine, Obs) {
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    let obs: Obs = Arc::new(Mutex::new(Observed::default()));
    spawn_pump(rx, obs.clone());
    let engine = Engine::with_connectivity(cfg, tx, net);
    let e = engine.clone();
    tokio::spawn(async move { e.run_network_monitor().await });
    (engine, obs)
}

fn request(url: String) -> AddRequest {
    AddRequest { url, connections: Some(8), ..Default::default() }
}

async fn wait_for(
    engine: &Engine,
    id: &str,
    what: &str,
    timeout: Duration,
    pred: impl Fn(&DownloadInfo) -> bool,
) -> DownloadInfo {
    let t = Instant::now();
    loop {
        let info = engine.info(id).expect("download exists");
        if pred(&info) {
            return info;
        }
        if t.elapsed() > timeout {
            panic!("timed out waiting for {what}; last state: {info:#?}");
        }
        tokio::time::sleep(Duration::from_millis(15)).await;
    }
}

async fn wait_state(engine: &Engine, id: &str, state: DownloadState) -> DownloadInfo {
    // Generous: this machine's disk can stall an fsync for tens of seconds under load.
    wait_for(engine, id, &format!("{state:?}"), Duration::from_secs(150), |i| i.state == state).await
}

/// Wait until every byte has been received (not until the final fsync / verification is done), so
/// timing assertions measure the network path and not the disk. Returns the elapsed time.
async fn wait_all_bytes(engine: &Engine, id: &str, size: u64, since: Instant) -> Duration {
    wait_for(engine, id, "all bytes received", Duration::from_secs(150), |i| i.downloaded >= size).await;
    since.elapsed()
}

async fn wait_percent(engine: &Engine, id: &str, percent: u64) -> DownloadInfo {
    wait_for(engine, id, &format!("{percent}% progress"), Duration::from_secs(120), |i| {
        i.total_size.is_some_and(|t| t > 0 && i.downloaded * 100 >= t * percent)
    })
    .await
}

/// Wait until the persisted (database) copy catches up with the given in-memory byte count.
async fn wait_persisted_downloaded(obs: &Obs, id: &str, at_least: u64) -> DownloadRecord {
    let t = Instant::now();
    loop {
        if let Some(r) = obs.lock().unwrap().persisted.get(id) {
            if r.downloaded >= at_least {
                return r.clone();
            }
        }
        assert!(t.elapsed() < Duration::from_secs(10), "persisted record never caught up");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

async fn serve(cfg: ServerConfig) -> TestServer {
    common::spawn(cfg, "127.0.0.1:0").await
}

fn dir_entries(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
        .collect();
    v.sort();
    v
}

fn file_of(info: &DownloadInfo) -> PathBuf {
    PathBuf::from(&info.file_path)
}

// ---------- basic downloads ------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn segmented_download_is_byte_exact_and_uses_parallel_connections() {
    let size = 24 * MIB + 123;
    let server = serve(ServerConfig {
        size,
        rate_per_conn: 8 * MIB,
        file_name: Some("movie.bin".into()),
        ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());

    let info = engine.add(request(server.url())).await.unwrap();
    let done = wait_state(&engine, &info.id, DownloadState::Completed).await;

    assert_eq!(done.file_name, "movie.bin", "name comes from Content-Disposition");
    assert_eq!(done.total_size, Some(size));
    assert_eq!(done.downloaded, size);
    assert_eq!(done.resume_supported, Some(true));
    assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256());
    assert!(
        server.stats.peak_connections.load(Ordering::SeqCst) >= 6,
        "expected ~8 parallel connections, saw {}",
        server.stats.peak_connections.load(Ordering::SeqCst)
    );
    // No .part files, no merge leftovers: the destination file is the only thing on disk.
    assert_eq!(dir_entries(dir.path()), vec!["movie.bin".to_string()]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn falls_back_to_ranged_get_when_head_is_rejected() {
    let size = 6 * MIB + 5;
    let server = serve(ServerConfig { size, head: false, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());

    let info = engine.add(request(server.url())).await.unwrap();
    let done = wait_state(&engine, &info.id, DownloadState::Completed).await;
    assert_eq!(done.total_size, Some(size));
    assert_eq!(done.resume_supported, Some(true));
    assert_eq!(done.file_name, "file.bin", "no Content-Disposition: name comes from the URL");
    assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn server_without_ranges_uses_one_connection_and_is_flagged() {
    let size = 5 * MIB + 17;
    let server = serve(ServerConfig { size, ranges: false, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());

    let info = engine.add(request(server.url())).await.unwrap();
    let done = wait_state(&engine, &info.id, DownloadState::Completed).await;
    assert_eq!(done.resume_supported, Some(false), "UI shows \"Resume not supported\"");
    // Exactly one whole-file connection. (The probe's own 1-byte ranged GET may briefly overlap it
    // on the server side while the server notices that the client hung up, so count requests.)
    assert_eq!(server.stats.full_gets.load(Ordering::SeqCst), 1);
    assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn unknown_length_chunked_download_completes() {
    let size = 3 * MIB + 1;
    let server = serve(ServerConfig { size, ranges: false, chunked: true, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());

    let info = engine.add(request(server.url())).await.unwrap();
    let done = wait_state(&engine, &info.id, DownloadState::Completed).await;
    assert_eq!(done.total_size, Some(size), "size is learned from what arrived");
    assert_eq!(std::fs::metadata(file_of(&done)).unwrap().len(), size);
    assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn empty_file_completes() {
    let server = serve(ServerConfig { size: 0, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());
    let info = engine.add(request(server.url())).await.unwrap();
    let done = wait_state(&engine, &info.id, DownloadState::Completed).await;
    assert_eq!(std::fs::metadata(file_of(&done)).unwrap().len(), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn same_name_downloads_get_unique_file_names() {
    let server = serve(ServerConfig { size: MIB, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());
    let a = engine.add(request(server.url())).await.unwrap();
    let b = engine.add(request(server.url())).await.unwrap();
    wait_state(&engine, &a.id, DownloadState::Completed).await;
    wait_state(&engine, &b.id, DownloadState::Completed).await;
    assert_eq!(dir_entries(dir.path()), vec!["file (1).bin".to_string(), "file.bin".to_string()]);
}

// ---------- pause / resume / restart ---------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn pause_then_resume_continues_without_redownloading() {
    let size = 16 * MIB;
    let server = serve(ServerConfig { size, rate_per_conn: 2 * MIB, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, obs) = make_engine(dir.path());

    let mut req = request(server.url());
    req.connections = Some(4);
    let info = engine.add(req).await.unwrap();
    wait_percent(&engine, &info.id, 30).await;

    engine.pause(&info.id).await.unwrap();
    let paused = engine.info(&info.id).unwrap();
    assert_eq!(paused.state, DownloadState::Paused);
    assert!(paused.downloaded > 0 && paused.downloaded < size);
    // The saved progress is exactly what was in memory at pause time.
    let saved = wait_persisted_downloaded(&obs, &info.id, paused.downloaded).await;
    assert_eq!(saved.downloaded, paused.downloaded);
    assert_eq!(saved.state, DownloadState::Paused);

    // Nothing moves while paused. The server may still push a chunk or two into sockets the
    // client has already closed (they sit in kernel buffers until the reset arrives), so let it
    // settle, then require both sides to be completely still.
    tokio::time::sleep(Duration::from_millis(300)).await;
    let settled = server.stats.bytes_sent.load(Ordering::SeqCst);
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(server.stats.bytes_sent.load(Ordering::SeqCst), settled, "server kept streaming after pause");
    let still = engine.info(&info.id).unwrap();
    assert_eq!(still.downloaded, paused.downloaded, "client kept receiving data while paused");
    assert_eq!(still.state, DownloadState::Paused);
    assert_eq!(still.speed_bps, 0);

    engine.resume(&info.id).await.unwrap();
    let done = wait_state(&engine, &info.id, DownloadState::Completed).await;
    assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256());
    // Resume asked only for what was missing: total traffic stays close to the file size.
    let sent = server.stats.bytes_sent.load(Ordering::SeqCst);
    assert!(sent < size + size / 5, "re-downloaded too much: {sent} bytes sent for a {size} byte file");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn app_restart_resumes_from_saved_record() {
    let size = 16 * MIB;
    let server = serve(ServerConfig { size, rate_per_conn: 2 * MIB, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();

    // --- first run of the app ---
    let (engine1, obs1) = make_engine(dir.path());
    let info = engine1.add(request(server.url())).await.unwrap();
    let at_pause = wait_percent(&engine1, &info.id, 40).await;
    engine1.shutdown().await; // what the app does when the window is closed
    let record = obs1.lock().unwrap().persisted.get(&info.id).cloned().expect("record was persisted");
    assert_eq!(record.state, DownloadState::Paused);
    assert!(record.interrupted, "closing the app marks the running download so it can continue after the restart");
    assert!(record.downloaded >= at_pause.downloaded && record.downloaded < size);
    drop(engine1);

    // The database stores JSON; make sure the record survives that round trip.
    let json = serde_json::to_string(&record).unwrap();
    let record: DownloadRecord = serde_json::from_str(&json).unwrap();

    // --- second run of the app ---
    let (engine2, _obs2) = make_engine(dir.path());
    engine2.restore(vec![record.clone()]);
    let restored = engine2.info(&info.id).unwrap();
    assert_eq!(restored.state, DownloadState::Paused);
    assert_eq!(restored.downloaded, record.downloaded);
    assert_eq!(engine2.interrupted().first().map(|(id, _, _)| id.clone()), Some(info.id.clone()));

    engine2.resume(&info.id).await.unwrap();
    assert!(engine2.interrupted().is_empty(), "once resumed it is no longer waiting for a restart");
    let done = wait_state(&engine2, &info.id, DownloadState::Completed).await;
    assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256());
}

/// Simulates a crash / power cut: the first "process" is killed abruptly (no pause, no flush)
/// and a new engine resumes from the last durable checkpoint.
#[test]
fn crash_mid_download_then_resume_is_byte_exact() {
    let size = 16 * MIB;
    let server_rt = tokio::runtime::Runtime::new().unwrap();
    let server = server_rt.block_on(serve(ServerConfig { size, rate_per_conn: 2 * MIB, ..Default::default() }));
    let dir = tempfile::tempdir().unwrap();

    // --- process 1: killed while downloading ---
    let rt1 = tokio::runtime::Runtime::new().unwrap();
    let (id, last_checkpoint) = rt1.block_on(async {
        let (engine, obs) = make_engine(dir.path());
        let info = engine.add(request(server.url())).await.unwrap();
        let rec = wait_persisted_downloaded(&obs, &info.id, 35 * size / 100).await;
        let latest = obs.lock().unwrap().persisted.get(&info.id).cloned().unwrap_or(rec);
        (info.id, latest)
    });
    rt1.shutdown_background(); // abrupt: tasks are dropped mid-flight
    assert!(last_checkpoint.downloaded > 0 && last_checkpoint.downloaded < size);

    // --- process 2: fresh engine, only the saved record and the file on disk ---
    let rt2 = tokio::runtime::Runtime::new().unwrap();
    rt2.block_on(async {
        let (engine, _obs) = make_engine(dir.path());
        engine.restore(vec![last_checkpoint]);
        assert_eq!(engine.info(&id).unwrap().state, DownloadState::Paused);
        engine.resume(&id).await.unwrap();
        let done = wait_state(&engine, &id, DownloadState::Completed).await;
        assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256());
    });
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn dropped_connections_are_retried_and_resumed() {
    // Every response is cut after 1 MiB, like a flaky line. 6 MiB over 2 connections needs
    // many reconnects, each continuing exactly where the last one stopped.
    let size = 6 * MIB + 7;
    let server = serve(ServerConfig {
        size,
        max_bytes_per_response: Some(MIB),
        ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());
    let mut req = request(server.url());
    req.connections = Some(2);
    let info = engine.add(req).await.unwrap();
    let done = wait_state(&engine, &info.id, DownloadState::Completed).await;
    assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256());
    assert!(server.stats.get_requests.load(Ordering::SeqCst) > 6);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn changed_file_is_detected_on_resume_and_restart_fixes_it() {
    let size = 12 * MIB;
    let server = serve(ServerConfig { size, rate_per_conn: 2 * MIB, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());

    let mut req = request(server.url());
    req.connections = Some(4);
    let info = engine.add(req).await.unwrap();
    wait_percent(&engine, &info.id, 30).await;
    engine.pause(&info.id).await.unwrap();

    // The file on the server is replaced by a different one.
    server.update(|c| {
        c.seed = 2;
        c.etag = Some("\"v2\"".into());
        c.rate_per_conn = 0;
    });
    engine.resume(&info.id).await.unwrap();
    let failed = wait_state(&engine, &info.id, DownloadState::Failed).await;
    let err = failed.error.expect("has an error");
    assert_eq!(err.code, "file_changed");
    assert!(err.message.contains("Restart"), "message tells the user what to do: {}", err.message);

    engine.restart(&info.id).await.unwrap();
    let done = wait_state(&engine, &info.id, DownloadState::Completed).await;
    assert_eq!(common::sha256_file(&file_of(&done)), common::sha256_hex_of_generated(2, size));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn cancel_deletes_partial_file_and_restart_downloads_again() {
    let size = 12 * MIB;
    let server = serve(ServerConfig { size, rate_per_conn: 2 * MIB, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());

    let info = engine.add(request(server.url())).await.unwrap();
    wait_percent(&engine, &info.id, 20).await;
    engine.cancel(&info.id).await.unwrap();
    let c = engine.info(&info.id).unwrap();
    assert_eq!(c.state, DownloadState::Cancelled);
    assert_eq!(c.downloaded, 0);
    assert!(dir_entries(dir.path()).is_empty(), "partial file was removed");

    server.update(|c| c.rate_per_conn = 0);
    engine.restart(&info.id).await.unwrap();
    let done = wait_state(&engine, &info.id, DownloadState::Completed).await;
    assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256());

    // Restarting a finished download downloads it again.
    engine.restart(&info.id).await.unwrap();
    let again = wait_state(&engine, &info.id, DownloadState::Completed).await;
    assert_eq!(common::sha256_file(&file_of(&again)), server.expected_sha256());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn remove_deletes_partial_but_keeps_finished_file_unless_asked() {
    let server = serve(ServerConfig { size: 10 * MIB, rate_per_conn: 2 * MIB, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, obs) = make_engine(dir.path());

    // Unfinished: file is deleted.
    let a = engine.add(request(server.url())).await.unwrap();
    wait_percent(&engine, &a.id, 20).await;
    engine.remove(&a.id, false).await.unwrap();
    assert!(engine.info(&a.id).is_err());
    assert!(dir_entries(dir.path()).is_empty());

    // Finished: file stays by default ...
    server.update(|c| c.rate_per_conn = 0);
    let b = engine.add(request(server.url())).await.unwrap();
    wait_state(&engine, &b.id, DownloadState::Completed).await;
    engine.remove(&b.id, false).await.unwrap();
    assert_eq!(dir_entries(dir.path()), vec!["file.bin".to_string()]);
    assert!(obs.lock().unwrap().persisted.get(&b.id).is_none() || {
        // the pump may still be catching up; give it a moment
        tokio::time::sleep(Duration::from_millis(200)).await;
        obs.lock().unwrap().persisted.get(&b.id).is_none()
    });

    // ... and is deleted when asked.
    let c = engine.add(request(server.url())).await.unwrap();
    wait_state(&engine, &c.id, DownloadState::Completed).await;
    engine.remove(&c.id, true).await.unwrap();
    assert_eq!(dir_entries(dir.path()), vec!["file.bin".to_string()], "only the earlier kept file remains");
}

// ---------- speed limits ---------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn per_download_speed_limit_is_enforced() {
    let size = 3 * MIB;
    let server = serve(ServerConfig { size, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());

    let mut req = request(server.url());
    req.speed_limit = Some(3 * MIB / 2); // 1.5 MiB/s -> about 2 s
    let t = Instant::now();
    let info = engine.add(req).await.unwrap();
    let done = wait_state(&engine, &info.id, DownloadState::Completed).await;
    let secs = t.elapsed().as_secs_f64();
    assert!(secs >= 1.5, "finished too fast for a 1.5 MiB/s limit: {secs:.2}s");
    assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn global_speed_limit_is_enforced_and_can_be_changed_live() {
    let size = 6 * MIB;
    let server = serve(ServerConfig { size, rate_per_conn: 4 * MIB, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());
    engine.set_global_speed_limit(MIB); // 1 MiB/s for everything

    let t = Instant::now();
    let info = engine.add(request(server.url())).await.unwrap();
    wait_percent(&engine, &info.id, 25).await;
    let limited_secs = t.elapsed().as_secs_f64();
    // Lift the limit while it is running: the rest should go quickly.
    engine.set_global_speed_limit(0);
    let secs = wait_all_bytes(&engine, &info.id, size, t).await.as_secs_f64();
    wait_state(&engine, &info.id, DownloadState::Completed).await;
    eprintln!("global limit test: 25% after {limited_secs:.2}s, completed after {secs:.2}s");
    assert!(secs >= 1.0, "the limit never applied: {secs:.2}s");
    assert!(secs < 5.5, "the limit was not lifted: {secs:.2}s");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn set_download_speed_limit_is_persisted() {
    let server = serve(ServerConfig { size: 8 * MIB, rate_per_conn: MIB, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, obs) = make_engine(dir.path());
    let info = engine.add(request(server.url())).await.unwrap();
    engine.set_download_speed_limit(&info.id, 123_456).unwrap();
    assert_eq!(engine.info(&info.id).unwrap().speed_limit, 123_456);
    let t = Instant::now();
    loop {
        if obs.lock().unwrap().persisted.get(&info.id).is_some_and(|r| r.speed_limit == 123_456) {
            break;
        }
        assert!(t.elapsed() < Duration::from_secs(5));
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    engine.cancel(&info.id).await.unwrap();
}

// ---------- verification ---------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn checksum_match_is_reported_and_mismatch_fails_with_a_clear_message() {
    let server = serve(ServerConfig { size: 2 * MIB + 3, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());

    let mut ok = request(server.url());
    ok.checksum = Some(format!("sha256:{}", server.expected_sha256()));
    let a = engine.add(ok).await.unwrap();
    let done = wait_state(&engine, &a.id, DownloadState::Completed).await;
    assert_eq!(done.checksum_verified, Some(true));

    let mut bad = request(server.url());
    bad.checksum = Some("sha256:".to_string() + &"0".repeat(64));
    let b = engine.add(bad).await.unwrap();
    let failed = wait_state(&engine, &b.id, DownloadState::Failed).await;
    assert_eq!(failed.checksum_verified, Some(false));
    let err = failed.error.unwrap();
    assert_eq!(err.code, "checksum_mismatch");
    assert!(err.message.contains("SHA-256"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn invalid_checksum_text_is_rejected_when_adding() {
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());
    let mut r = request("http://127.0.0.1:1/x".into());
    r.checksum = Some("not-a-checksum".into());
    assert_eq!(engine.add(r).await.unwrap_err().code(), "invalid_option");
}

// ---------- HTTP features --------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn basic_auth() {
    let server = serve(ServerConfig {
        size: 4 * MIB,
        auth: AuthMode::Basic { user: "alice".into(), pass: "s3cret".into() },
        ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());

    // Without credentials the user gets a clear message.
    let a = engine.add(request(server.url())).await.unwrap();
    let failed = wait_state(&engine, &a.id, DownloadState::Failed).await;
    assert!(failed.error.unwrap().message.contains("username and password"));

    // With credentials, every segment connection authenticates.
    let mut r = request(server.url());
    r.http = HttpOptions { username: Some("alice".into()), password: Some("s3cret".into()), ..Default::default() };
    let b = engine.add(r).await.unwrap();
    let done = wait_state(&engine, &b.id, DownloadState::Completed).await;
    assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256());

    // Wrong password is reported as such.
    let mut r = request(server.url());
    r.http = HttpOptions { username: Some("alice".into()), password: Some("nope".into()), ..Default::default() };
    let c = engine.add(r).await.unwrap();
    let failed = wait_state(&engine, &c.id, DownloadState::Failed).await;
    assert!(failed.error.is_some());
}

/// `http://user:pass@host/file` works, and the password does not stay in the stored link.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_password_typed_inside_the_link_moves_out_of_the_link() {
    let server = serve(ServerConfig {
        size: 2 * MIB,
        auth: AuthMode::Basic { user: "alice".into(), pass: "p@ss word".into() },
        ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());
    let link = server.url().replacen("http://", "http://alice:p%40ss%20word@", 1);
    let info = engine.add(request(link)).await.unwrap();
    assert!(!info.url.contains("alice") && !info.url.contains("ss"), "credentials left in the link: {}", info.url);
    let done = wait_state(&engine, &info.id, DownloadState::Completed).await;
    assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256());
    let rec = engine.record(&info.id).unwrap();
    assert_eq!(rec.http.username.as_deref(), Some("alice"));
    assert_eq!(rec.http.password.as_deref(), Some("p@ss word"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn digest_auth() {
    let server = serve(ServerConfig {
        size: 4 * MIB,
        auth: AuthMode::Digest { user: "bob".into(), pass: "hunter2".into() },
        ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());

    let mut r = request(server.url());
    r.http = HttpOptions { username: Some("bob".into()), password: Some("hunter2".into()), ..Default::default() };
    let info = engine.add(r).await.unwrap();
    let done = wait_state(&engine, &info.id, DownloadState::Completed).await;
    assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn redirects_headers_referer_user_agent_and_cookies_are_sent() {
    let server = serve(ServerConfig { size: 3 * MIB, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());

    let mut r = request(server.url_path("/redir")); // 302 -> /file.bin
    r.http = HttpOptions {
        user_agent: Some("TestAgent/9.9".into()),
        referer: Some("https://example.org/page".into()),
        headers: vec![("X-Test".into(), "hello".into())],
        cookies: Some("sid=abc123; theme=dark".into()),
        ..Default::default()
    };
    let info = engine.add(r).await.unwrap();
    let done = wait_state(&engine, &info.id, DownloadState::Completed).await;
    assert_eq!(done.file_name, "file.bin", "name is taken from the URL after the redirect");
    assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256());

    let headers = server.stats.headers.lock().unwrap().clone();
    let file_requests: Vec<_> = headers.iter().filter(|h| h.get("x-test").is_some()).collect();
    assert!(!file_requests.is_empty(), "custom header reached the server");
    for h in file_requests {
        assert_eq!(h.get("user-agent").map(String::as_str), Some("TestAgent/9.9"));
        assert_eq!(h.get("x-test").map(String::as_str), Some("hello"));
        assert_eq!(h.get("accept-encoding").map(String::as_str), Some("identity"));
    }
    assert!(
        headers.iter().any(|h| h.get("referer").is_some_and(|r| r.contains("example.org/page"))),
        "referer was sent"
    );
    assert!(
        headers.iter().any(|h| h.get("cookie").is_some_and(|c| c.contains("sid=abc123"))),
        "cookies were sent"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn redirect_loops_stop_after_ten_hops_with_a_clear_message() {
    let server = serve(ServerConfig::default()).await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());
    let info = engine.add(request(server.url_path("/loop"))).await.unwrap();
    let failed = wait_state(&engine, &info.id, DownloadState::Failed).await;
    assert_eq!(failed.error.unwrap().code, "too_many_redirects");
    // 1 HEAD + 1 GET, each up to 11 requests: the loop was cut, not followed forever.
    assert!(server.stats.requests.load(Ordering::SeqCst) <= 30);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn missing_file_gives_a_plain_language_error() {
    let server = serve(ServerConfig::default()).await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());
    let info = engine.add(request(server.url_path("/nope.zip"))).await.unwrap();
    let failed = wait_state(&engine, &info.id, DownloadState::Failed).await;
    let err = failed.error.unwrap();
    assert_eq!(err.code, "http");
    assert!(err.message.contains("not found"), "{}", err.message);
}

/// A login page where the file should be is reported plainly instead of being saved as "login.zip".
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_web_page_instead_of_the_file_fails_with_a_clear_reason() {
    let server = serve(ServerConfig::default()).await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());
    let info = engine.add(request(server.url_path("/login.zip"))).await.unwrap();
    let failed = wait_state(&engine, &info.id, DownloadState::Failed).await;
    let err = failed.error.unwrap();
    assert_eq!(err.code, "wrong_file");
    assert!(err.message.contains("sign in"), "{}", err.message);
    assert!(dir_entries(dir.path()).iter().all(|f| !f.contains("login")), "no page was saved as the file");
}

/// A pause the user asked for must not be undone by "resume on restart".
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_download_the_user_paused_is_not_resumed_after_a_restart() {
    let size = 16 * MIB;
    let server = serve(ServerConfig { size, rate_per_conn: 2 * MIB, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let (engine1, obs1) = make_engine(dir.path());
    let info = engine1.add(request(server.url())).await.unwrap();
    wait_percent(&engine1, &info.id, 20).await;
    engine1.pause(&info.id).await.unwrap();
    engine1.shutdown().await;
    let record = obs1.lock().unwrap().persisted.get(&info.id).cloned().unwrap();
    assert!(!record.interrupted);
    let (engine2, _obs2) = make_engine(dir.path());
    engine2.restore(vec![record]);
    assert!(engine2.interrupted().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn unreachable_server_fails_with_a_network_message_and_can_be_retried() {
    // Nothing listens on this port.
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());
    let info = engine.add(request("http://127.0.0.1:9/file.bin".into())).await.unwrap();
    let failed = wait_state(&engine, &info.id, DownloadState::Failed).await;
    // Nothing is listening: the app says "refused" (and what to check), not a vague network error.
    let code = failed.error.unwrap().code;
    assert!(code == "refused" || code == "network", "{code}");
    // Still in the list, can be resumed (it will fail again here, but is accepted).
    engine.resume(&info.id).await.unwrap();
    engine.cancel(&info.id).await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn drm_sites_and_bad_links_are_refused_up_front() {
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());

    let e = engine.add(request("https://www.netflix.com/watch/123".into())).await.unwrap_err();
    assert_eq!(e.code(), "blocked");
    assert!(e.user_message().contains("DRM"));
    assert_eq!(engine.add(request("not a url".into())).await.unwrap_err().code(), "invalid_url");
    assert_eq!(engine.add(request("ftp://example.com/a".into())).await.unwrap_err().code(), "unsupported_scheme");
    assert!(engine.list().is_empty(), "refused links never enter the list");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn connections_setting_is_clamped_to_1_to_32() {
    let server = serve(ServerConfig { size: 40 * MIB, rate_per_conn: MIB, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());
    let mut r = request(server.url());
    r.connections = Some(500);
    let a = engine.add(r).await.unwrap();
    assert_eq!(a.connections, 32);
    let mut r = request(server.url());
    r.connections = Some(0);
    let b = engine.add(r).await.unwrap();
    assert_eq!(b.connections, 1);
    engine.cancel(&a.id).await.unwrap();
    engine.cancel(&b.id).await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn progress_events_carry_speed_eta_and_segments() {
    let size = 12 * MIB;
    let server = serve(ServerConfig { size, rate_per_conn: 2 * MIB, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, obs) = make_engine(dir.path());
    let mut r = request(server.url());
    r.connections = Some(4);
    let info = engine.add(r).await.unwrap();
    wait_state(&engine, &info.id, DownloadState::Completed).await;

    let events = obs.lock().unwrap().progress.clone();
    assert!(events.len() >= 5, "got only {} progress events", events.len());
    let mid: Vec<_> = events.iter().filter(|e| e.downloaded > 0 && e.downloaded < size).collect();
    assert!(mid.iter().any(|e| e.speed_bps > 0), "speed is reported");
    assert!(mid.iter().any(|e| e.eta_secs.is_some()), "ETA is reported");
    // Work stealing may add segments near the end, but never fewer than the 4 we started with.
    assert!(events.iter().all(|e| e.segments.len() >= 4 && e.total == Some(size)));
    // Per-segment progress adds up to the overall number.
    for e in &events {
        assert_eq!(e.segments.iter().map(|s| s.downloaded).sum::<u64>(), e.downloaded);
    }
    // Monotonic.
    assert!(events.windows(2).all(|w| w[0].downloaded <= w[1].downloaded));
}

// =========================================================================================
// Phase 2: faster on slow and unstable connections
// =========================================================================================

fn states_of(obs: &Obs, id: &str) -> Vec<DownloadState> {
    obs.lock().unwrap().states.get(id).cloned().unwrap_or_default()
}

/// Config with the Phase 2 safety nets switched off, so a test can isolate one mechanism.
fn quiet_config(dir: &Path) -> EngineConfig {
    let mut c = test_config(dir);
    c.stall_zero_after = Duration::from_secs(120);
    c.stall_slow_after = Duration::from_secs(600);
    c
}

// ---------- 1. dynamic segmentation (work stealing) ------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn work_stealing_rescues_a_slow_segment() {
    // 4 segments of 2 MiB. The one starting at 6 MiB is served at only 512 KiB/s (4 s alone).
    let size = 8 * MIB;
    let make = || ServerConfig {
        size,
        rate_per_conn: 8 * MIB,
        trouble: vec![Trouble { start: 6 * MIB, kind: TroubleKind::Slow(512 * KIB), once: false }],
        ..Default::default()
    };

    // With work stealing: finished connections take over the slow segment's tail.
    let server = serve(make()).await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine_with(quiet_config(dir.path()));
    let mut req = request(server.url());
    req.connections = Some(4);
    let t = Instant::now();
    let info = engine.add(req).await.unwrap();
    let with_stealing = wait_all_bytes(&engine, &info.id, size, t).await.as_secs_f64();
    let done = wait_state(&engine, &info.id, DownloadState::Completed).await;
    assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256());
    let starts = server.stats.range_starts.lock().unwrap().clone();
    assert!(starts.len() > 4, "new connections were opened on stolen ranges: {starts:?}");
    assert!(
        starts.iter().any(|&s| s > 6 * MIB && s < 8 * MIB),
        "something was stolen from inside the slow segment: {starts:?}"
    );
    // Almost nothing is downloaded twice (a stolen range is cut off the victim's connection).
    let sent = server.stats.bytes_sent.load(Ordering::SeqCst);
    assert!(sent < size + size / 4, "{sent} bytes sent for a {size} byte file");

    // Control: the same download with stealing disabled is dominated by the slow segment.
    let server2 = serve(make()).await;
    let dir2 = tempfile::tempdir().unwrap();
    let mut cfg = quiet_config(dir2.path());
    cfg.work_stealing = false;
    let (engine2, _obs2) = make_engine_with(cfg);
    let mut req = request(server2.url());
    req.connections = Some(4);
    let t = Instant::now();
    let info = engine2.add(req).await.unwrap();
    let without_stealing = wait_all_bytes(&engine2, &info.id, size, t).await.as_secs_f64();
    let done = wait_state(&engine2, &info.id, DownloadState::Completed).await;
    assert_eq!(common::sha256_file(&file_of(&done)), server2.expected_sha256());

    println!("work stealing: {with_stealing:.1}s with, {without_stealing:.1}s without");
    assert!(without_stealing >= 3.5, "control should be slow, took {without_stealing:.1}s");
    assert!(with_stealing < 3.0, "stealing should rescue the slow segment, took {with_stealing:.1}s");
    assert!(with_stealing * 1.5 < without_stealing);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn many_connections_with_uneven_speeds_still_produce_the_exact_file() {
    // 12 segments, three of them very slow: lots of stealing and re-stealing.
    let size = 48 * MIB;
    let slow = |i: u64| Trouble { start: i * 4 * MIB, kind: TroubleKind::Slow(300 * KIB), once: false };
    let server = serve(ServerConfig {
        size,
        rate_per_conn: 12 * MIB,
        trouble: vec![slow(2), slow(5), slow(9)],
        ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, obs) = make_engine_with(quiet_config(dir.path()));
    let mut req = request(server.url());
    req.connections = Some(12);
    let t = Instant::now();
    let info = engine.add(req).await.unwrap();
    let secs = wait_all_bytes(&engine, &info.id, size, t).await.as_secs_f64();
    let done = wait_state(&engine, &info.id, DownloadState::Completed).await;
    assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256());
    assert!(secs < 12.0, "took {secs:.1}s; unstolen it would take ~14 s for the slow segments alone");
    // The saved layout after all that splitting is still a valid, contiguous partition.
    let rec = wait_persisted_downloaded(&obs, &info.id, size).await;
    assert!(flowget_engine::segments::is_consistent(&rec.segments, size), "{:?}", rec.segments);
    assert!(rec.segments.len() > 12, "stealing created extra segments");
}

// ---------- 2. stall detection ---------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_connection_with_no_data_is_closed_and_reopened() {
    // The segment starting at 4 MiB sends 256 KiB, then the server goes silent but keeps the
    // connection open. Without stall detection this would hang for the 20 s read timeout.
    let size = 8 * MIB;
    let server = serve(ServerConfig {
        size,
        rate_per_conn: 8 * MIB,
        trouble: vec![Trouble { start: 4 * MIB, kind: TroubleKind::StallAfter(256 * KIB), once: true }],
        ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let mut cfg = test_config(dir.path());
    cfg.work_stealing = false; // isolate stall handling
    cfg.stall_zero_after = Duration::from_millis(500);
    let (engine, _obs) = make_engine_with(cfg);
    let mut req = request(server.url());
    req.connections = Some(2);
    let t = Instant::now();
    let info = engine.add(req).await.unwrap();
    let secs = wait_all_bytes(&engine, &info.id, size, t).await.as_secs_f64();
    let done = wait_state(&engine, &info.id, DownloadState::Completed).await;
    assert!(secs < 6.0, "stalled connection was not replaced quickly: {secs:.1}s");
    assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256());
    // The reopened connection asked only for what was still missing, not the whole segment.
    let starts = server.stats.range_starts.lock().unwrap().clone();
    assert!(starts.iter().any(|&s| s > 4 * MIB && s < 8 * MIB), "no reopen request seen: {starts:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_connection_far_below_the_average_speed_is_replaced() {
    // 4 segments at ~2 MiB/s each; the one at 8 MiB crawls at 20 KiB/s (200 s on its own).
    let size = 16 * MIB;
    let server = serve(ServerConfig {
        size,
        rate_per_conn: 2 * MIB,
        trouble: vec![Trouble { start: 8 * MIB, kind: TroubleKind::Slow(20 * KIB), once: true }],
        ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let mut cfg = test_config(dir.path());
    cfg.work_stealing = false; // isolate stall handling
    cfg.stall_slow_after = Duration::from_millis(700);
    let (engine, _obs) = make_engine_with(cfg);
    let mut req = request(server.url());
    req.connections = Some(4);
    let t = Instant::now();
    let info = engine.add(req).await.unwrap();
    let secs = wait_all_bytes(&engine, &info.id, size, t).await.as_secs_f64();
    let done = wait_state(&engine, &info.id, DownloadState::Completed).await;
    assert!(secs < 12.0, "slow connection was not replaced: {secs:.1}s");
    assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256());
    let starts = server.stats.range_starts.lock().unwrap().clone();
    assert!(starts.iter().any(|&s| s > 8 * MIB && s < 12 * MIB), "no reopen request seen: {starts:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_download_throttled_by_the_speed_limiter_is_not_mistaken_for_a_stall() {
    // A tight limit makes every connection wait for tokens for long stretches. That is
    // deliberate idling and must not trigger the 3 s stall rule (default setting here).
    let size = 3 * MIB;
    let server = serve(ServerConfig { size, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let mut cfg = test_config(dir.path());
    cfg.work_stealing = false; // stealing opens extra connections on purpose; count only reopens
    cfg.stall_zero_after = Duration::from_millis(400);
    cfg.stall_slow_after = Duration::from_millis(600);
    let (engine, _obs) = make_engine_with(cfg);
    engine.set_global_speed_limit(MIB); // 3 s of transfer, connections waiting on tokens
    let info = engine.add(request(server.url())).await.unwrap();
    let done = wait_state(&engine, &info.id, DownloadState::Completed).await;
    assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256());
    // 3 MiB = 3 segments = 3 connections. Had any been torn down as "stalled", the server would
    // have seen extra requests for the same ranges.
    let gets = server.stats.get_requests.load(Ordering::SeqCst);
    assert_eq!(gets, 3, "{gets} GET requests: connections were being reopened needlessly");
}

// ---------- 3. adaptive connection count -----------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn connection_count_is_halved_when_the_server_keeps_refusing_connections() {
    // The server only tolerates 3 simultaneous transfers; we ask for 8.
    let size = 16 * MIB;
    let server = serve(ServerConfig {
        size,
        rate_per_conn: 2 * MIB,
        max_concurrent: Some(3),
        ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let mut cfg = test_config(dir.path());
    cfg.fail_threshold = 4;
    cfg.fail_window = Duration::from_secs(10);
    cfg.halve_cooldown = Duration::from_millis(300);
    let (engine, obs) = make_engine_with(cfg);
    let mut req = request(server.url());
    req.connections = Some(8);
    let info = engine.add(req).await.unwrap();
    let done = wait_for(&engine, &info.id, "Completed", Duration::from_secs(90), |i| {
        i.state == DownloadState::Completed
    })
    .await;
    assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256());
    assert!(server.stats.refused.load(Ordering::SeqCst) > 0, "the server did refuse connections");
    assert!(done.connections <= 3, "count was cut to what the server tolerates, got {}", done.connections);
    assert!(done.connections >= 1);

    // ... and the engine remembers it for this website.
    let best = obs.lock().unwrap().domain_best.last().cloned().expect("a domain hint was emitted");
    assert_eq!(best.domain, "127.0.0.1");
    assert!(best.connections <= 3, "{best:?}");
    assert_eq!(engine.domain_hint("127.0.0.1").unwrap().connections, best.connections);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_large_clean_download_remembers_its_connection_count() {
    let size = 24 * MIB;
    let server = serve(ServerConfig { size, rate_per_conn: 2 * MIB, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, obs) = make_engine(dir.path());
    let mut req = request(server.url());
    req.connections = Some(4);
    let info = engine.add(req).await.unwrap();
    wait_state(&engine, &info.id, DownloadState::Completed).await;
    let best = obs.lock().unwrap().domain_best.last().cloned().expect("hint emitted");
    assert_eq!((best.domain.as_str(), best.connections), ("127.0.0.1", 4));
    // Measured over the transfer only (not the final fsync): about 8 MiB/s here, so well above 2.
    assert!(best.speed_bps > 2 * MIB, "{best:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn small_downloads_do_not_change_what_is_remembered() {
    let server = serve(ServerConfig { size: 2 * MIB, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, obs) = make_engine(dir.path());
    engine.set_domain_hints(vec![DomainHint { domain: "127.0.0.1".into(), connections: 6, speed_bps: 1_000_000 }]);
    let info = engine.add(request(server.url())).await.unwrap();
    wait_state(&engine, &info.id, DownloadState::Completed).await;
    assert!(obs.lock().unwrap().domain_best.is_empty());
    assert_eq!(engine.domain_hint("127.0.0.1").unwrap().connections, 6);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn remembered_count_is_used_unless_the_request_chooses() {
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());
    engine.set_domain_hints(vec![DomainHint { domain: "files.example.com".into(), connections: 3, speed_bps: 1 }]);

    let auto = AddRequest { url: "https://files.example.com/a.bin".into(), start_paused: true, ..Default::default() };
    assert_eq!(engine.add(auto.clone()).await.unwrap().connections, 3, "domain memory applies");
    let other = AddRequest { url: "https://other.example.com/a.bin".into(), ..auto.clone() };
    assert_eq!(engine.add(other).await.unwrap().connections, 8, "unknown domain uses the default");
    let explicit = AddRequest { connections: Some(5), ..auto };
    assert_eq!(engine.add(explicit).await.unwrap().connections, 5, "an explicit choice wins");
}

// ---------- 4. smart retry -------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn client_errors_are_retried_only_a_few_times() {
    // HEAD works, but every GET answers 404: 1 attempt + 3 retries, then a clear failure.
    let server = serve(ServerConfig { size: 4 * MIB, fail_status: Some(404), ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());
    let mut req = request(server.url());
    req.connections = Some(1);
    let info = engine.add(req).await.unwrap();
    let failed = wait_state(&engine, &info.id, DownloadState::Failed).await;
    assert_eq!(failed.error.unwrap().code, "http");
    assert_eq!(server.stats.get_requests.load(Ordering::SeqCst), 4);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn server_errors_honour_retry_after_and_stop_at_the_limit() {
    let server = serve(ServerConfig {
        size: 4 * MIB,
        fail_status: Some(503),
        retry_after: Some(1),
        ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let mut cfg = test_config(dir.path());
    cfg.retry.max_server_retries = 2;
    cfg.retry.max_delay = Duration::from_millis(400); // also caps Retry-After
    let (engine, _obs) = make_engine_with(cfg);
    let mut req = request(server.url());
    req.connections = Some(1);
    let t = Instant::now();
    let info = engine.add(req).await.unwrap();
    let failed = wait_state(&engine, &info.id, DownloadState::Failed).await;
    assert_eq!(server.stats.get_requests.load(Ordering::SeqCst), 3, "1 attempt + 2 retries");
    assert!(t.elapsed() >= Duration::from_millis(700), "Retry-After was ignored: {:?}", t.elapsed());
    assert!(failed.error.unwrap().message.contains("server"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn network_errors_are_retried_without_a_limit() {
    // The engine's retry limits here are tiny (3), yet a 2.5 s outage with ~20 ms..200 ms backoff
    // means well over a dozen failed attempts per connection: network errors must never give up.
    let size = 8 * MIB;
    let server = serve(ServerConfig { size, rate_per_conn: 2 * MIB, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, obs) = make_engine(dir.path()); // no network supervisor: pure retry behaviour
    let mut req = request(server.url());
    req.connections = Some(2);
    let info = engine.add(req).await.unwrap();
    wait_percent(&engine, &info.id, 20).await;

    server.set_offline(true);
    tokio::time::sleep(Duration::from_millis(2500)).await;
    let during = engine.info(&info.id).unwrap();
    assert!(during.state.is_active(), "still trying, state {:?}", during.state);
    assert!(during.note.as_deref().is_some_and(|n| n.contains("reconnecting")), "{:?}", during.note);

    server.set_offline(false);
    let done = wait_state(&engine, &info.id, DownloadState::Completed).await;
    assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256());
    assert!(!states_of(&obs, &info.id).contains(&DownloadState::Failed));
}

// ---------- 4b. "Waiting for network" and auto-resume ----------------------------------------

/// Cut the internet for `cut` while a download is running; it must park in "Waiting for
/// network", then resume by itself and finish with the right bytes.
async fn run_network_cut(cut: Duration, os_events: bool) {
    let size = 64 * MIB;
    let server = serve(ServerConfig { size, rate_per_conn: 2 * MIB, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let net = FakeNet::new(os_events);
    let (engine, obs) = make_engine_with_net(test_config(dir.path()), net.clone());
    let info = engine.add(request(server.url())).await.unwrap();
    wait_percent(&engine, &info.id, 25).await;

    // --- the internet goes away ---
    let cut_at = Instant::now();
    server.set_offline(true);
    net.set(false);
    let waiting = wait_for(&engine, &info.id, "WaitingForNetwork", Duration::from_secs(15), |i| {
        i.state == DownloadState::WaitingForNetwork
    })
    .await;
    println!("[network cut] parked after {:.2}s (os events: {os_events})", cut_at.elapsed().as_secs_f64());
    assert!(waiting.downloaded > 0 && waiting.downloaded < size);
    assert!(!engine.is_online());
    // The saved progress is exactly what had been downloaded.
    let saved = wait_persisted_downloaded(&obs, &info.id, waiting.downloaded).await;
    assert_eq!(saved.state, DownloadState::WaitingForNetwork);

    // --- stays parked for the whole outage, without failing or burning retries ---
    let remaining = cut.saturating_sub(cut_at.elapsed());
    tokio::time::sleep(remaining).await;
    let still = engine.info(&info.id).unwrap();
    assert_eq!(still.state, DownloadState::WaitingForNetwork, "must not fail during an outage");
    assert_eq!(still.downloaded, waiting.downloaded, "no progress while offline");

    // --- the internet comes back: it resumes on its own ---
    let back_at = Instant::now();
    server.set_offline(false);
    net.set(true);
    wait_for(&engine, &info.id, "resumed", Duration::from_secs(10), |i| i.state.is_active()).await;
    let latency = back_at.elapsed();
    println!("[network cut] resumed {:.2}s after the connection returned", latency.as_secs_f64());
    assert!(latency < Duration::from_secs(3), "resume took {latency:?}");
    assert!(engine.is_online());

    let done = wait_for(&engine, &info.id, "Completed", Duration::from_secs(120), |i| {
        i.state == DownloadState::Completed
    })
    .await;
    assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256());
    let states = states_of(&obs, &info.id);
    assert!(states.contains(&DownloadState::WaitingForNetwork));
    assert!(!states.contains(&DownloadState::Failed), "{states:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn short_network_cut_with_os_events_parks_and_auto_resumes() {
    run_network_cut(Duration::from_secs(2), true).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn network_cut_is_detected_and_ended_by_polling_alone() {
    // No OS "network changed" events at all: failures trigger a check, polling notices the return.
    run_network_cut(Duration::from_secs(5), false).await;
}

/// ACCEPTANCE TEST: the download auto-recovers from a 30-second internet cut.
///   cargo test -p flowget-engine --release -- --ignored --nocapture acceptance_network
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "takes ~45 s; run with: cargo test -p flowget-engine --release -- --ignored --nocapture acceptance_network"]
async fn acceptance_network_cut_30s_auto_recovers() {
    run_network_cut(Duration::from_secs(30), true).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_download_the_user_paused_is_not_resumed_when_the_network_returns() {
    let size = 64 * MIB;
    let server = serve(ServerConfig { size, rate_per_conn: 2 * MIB, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let net = FakeNet::new(true);
    let (engine, _obs) = make_engine_with_net(test_config(dir.path()), net.clone());
    let a = engine.add(request(server.url())).await.unwrap();
    let b = engine.add(request(server.url())).await.unwrap();
    wait_percent(&engine, &a.id, 10).await;
    wait_percent(&engine, &b.id, 10).await;
    engine.pause(&a.id).await.unwrap(); // the user's decision

    server.set_offline(true);
    net.set(false);
    wait_for(&engine, &b.id, "b waiting", Duration::from_secs(15), |i| i.state == DownloadState::WaitingForNetwork).await;
    assert_eq!(engine.info(&a.id).unwrap().state, DownloadState::Paused);

    server.set_offline(false);
    net.set(true);
    wait_for(&engine, &b.id, "b resumed", Duration::from_secs(10), |i| i.state.is_active()).await;
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(engine.info(&a.id).unwrap().state, DownloadState::Paused, "the user's pause is respected");
    engine.cancel(&a.id).await.unwrap();
    engine.cancel(&b.id).await.unwrap();
}

// ---------- 9. automatic link refresh --------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_expired_signed_link_is_refreshed_automatically() {
    // The download page (`/link`) redirects to a signed URL. Midway the signed URL expires; the
    // engine gets 403, asks the page again for a fresh one, and carries on from the same bytes.
    let size = 24 * MIB;
    let server = serve(ServerConfig {
        size,
        rate_per_conn: 4 * MIB,
        require_token: true,
        max_bytes_per_response: Some(MIB), // connections reconnect often, so they notice the expiry
        ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, obs) = make_engine(dir.path());
    let mut req = request(server.url_path("/link"));
    req.connections = Some(4);
    let info = engine.add(req).await.unwrap();
    wait_percent(&engine, &info.id, 20).await;
    let issued_before = server.stats.issued.load(Ordering::SeqCst);
    server.expire_links();

    let done = wait_for(&engine, &info.id, "Completed", Duration::from_secs(60), |i| {
        i.state == DownloadState::Completed
    })
    .await;
    assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256());
    assert!(server.stats.forbidden.load(Ordering::SeqCst) >= 1, "the old link was refused");
    assert!(server.stats.issued.load(Ordering::SeqCst) > issued_before, "a fresh link was requested");
    let states = states_of(&obs, &info.id);
    assert!(!states.contains(&DownloadState::LinkExpired) && !states.contains(&DownloadState::Failed), "{states:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn when_the_page_is_gone_the_download_asks_for_a_fresh_link() {
    let size = 16 * MIB;
    let server = serve(ServerConfig {
        size,
        rate_per_conn: 2 * MIB,
        require_token: true,
        max_bytes_per_response: Some(MIB),
        ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());
    let mut req = request(server.url_path("/link"));
    req.connections = Some(4);
    let info = engine.add(req).await.unwrap();
    wait_percent(&engine, &info.id, 20).await;
    // The signed link expires AND the page that issues links stops working.
    server.update(|c| c.link_dead = true);
    server.expire_links();

    let expired = wait_for(&engine, &info.id, "LinkExpired", Duration::from_secs(30), |i| {
        i.state == DownloadState::LinkExpired
    })
    .await;
    let err = expired.error.clone().unwrap();
    assert_eq!(err.code, "link_expired");
    assert!(err.message.contains("link"), "{}", err.message);
    assert!(expired.downloaded > 0 && expired.downloaded < size, "progress is kept");

    // A link to a *different* file is refused, and nothing changes.
    let other = serve(ServerConfig { size: size + 1, ..Default::default() }).await;
    let e = engine.refresh_link(&info.id, &other.url()).await.unwrap_err();
    assert_eq!(e.code(), "invalid_option");
    assert!(e.user_message().contains("different file"));
    assert_eq!(engine.info(&info.id).unwrap().state, DownloadState::LinkExpired);

    // The right file at a fresh address resumes where it stopped.
    server.update(|c| c.link_dead = false);
    engine.refresh_link(&info.id, &server.url_path("/link")).await.unwrap();
    let done = wait_state(&engine, &info.id, DownloadState::Completed).await;
    assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256());
}

// ---------- mirrors ----------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn verified_mirrors_serve_different_segments_at_the_same_time() {
    let size = 24 * MIB;
    let base = ServerConfig { size, rate_per_conn: 2 * MIB, ..Default::default() };
    let a = serve(base.clone()).await;
    let b = serve(base.clone()).await;
    let c = serve(base.clone()).await;
    // Two impostors: same name, but a different version (ETag) and a different size.
    let wrong_version = serve(ServerConfig { etag: Some("\"v2\"".into()), seed: 9, ..base.clone() }).await;
    let wrong_size = serve(ServerConfig { size: size + 1, ..base.clone() }).await;

    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());
    let mut req = request(a.url());
    req.connections = Some(6);
    req.mirrors = vec![b.url(), c.url(), wrong_version.url(), wrong_size.url()];
    let info = engine.add(req).await.unwrap();
    let done = wait_state(&engine, &info.id, DownloadState::Completed).await;

    // The result is exactly the file, with nothing from the impostors mixed in.
    assert_eq!(common::sha256_file(&file_of(&done)), a.expected_sha256());
    // Every verified source carried a real share of the file at the same time.
    for (name, s) in [("primary", &a), ("mirror 1", &b), ("mirror 2", &c)] {
        let sent = s.stats.bytes_sent.load(Ordering::SeqCst);
        assert!(sent > size / 8, "{name} only served {sent} bytes");
        assert!(s.stats.ranged_requests.load(Ordering::SeqCst) >= 1, "{name} got no range request");
    }
    // The impostors were looked at (a HEAD) and never asked for data.
    for (name, s) in [("wrong version", &wrong_version), ("wrong size", &wrong_size)] {
        assert_eq!(s.stats.bytes_sent.load(Ordering::SeqCst), 0, "{name} must not serve any bytes");
        assert_eq!(s.stats.get_requests.load(Ordering::SeqCst), 0, "{name}");
    }
    // The user is told which mirrors were used and why the others were not.
    let r = &done.mirrors;
    assert_eq!(r.len(), 4);
    assert!(r[0].ok && r[1].ok, "{r:?}");
    assert!(!r[2].ok && r[2].reason.as_deref().unwrap().contains("ETag"), "{r:?}");
    assert!(!r[3].ok && r[3].reason.as_deref().unwrap().contains("size"), "{r:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn mirrors_overcome_a_per_server_connection_limit() {
    // Each server accepts only 2 simultaneous transfers. One server alone is capped; three
    // verified mirrors give 6 real parallel connections.
    let size = 24 * MIB;
    let base = ServerConfig { size, rate_per_conn: 2 * MIB, max_concurrent: Some(2), ..Default::default() };

    let alone = serve(base.clone()).await;
    let dir = tempfile::tempdir().unwrap();
    let mut cfg = test_config(dir.path());
    cfg.fail_threshold = usize::MAX; // keep this comparison about the servers, not about halving
    let (engine, _obs) = make_engine_with(cfg);
    let mut req = request(alone.url());
    req.connections = Some(6);
    let t = Instant::now();
    let info = engine.add(req).await.unwrap();
    let single_source = wait_all_bytes(&engine, &info.id, size, t).await.as_secs_f64();
    wait_state(&engine, &info.id, DownloadState::Completed).await;

    let (a, b, c) = (serve(base.clone()).await, serve(base.clone()).await, serve(base.clone()).await);
    let dir2 = tempfile::tempdir().unwrap();
    let mut cfg = test_config(dir2.path());
    cfg.fail_threshold = usize::MAX;
    let (engine2, _obs2) = make_engine_with(cfg);
    let mut req = request(a.url());
    req.connections = Some(6);
    req.mirrors = vec![b.url(), c.url()];
    let t = Instant::now();
    let info = engine2.add(req).await.unwrap();
    let with_mirrors = wait_all_bytes(&engine2, &info.id, size, t).await.as_secs_f64();
    let done = wait_state(&engine2, &info.id, DownloadState::Completed).await;
    assert_eq!(common::sha256_file(&file_of(&done)), a.expected_sha256());

    println!("mirrors: {single_source:.1}s from one server, {with_mirrors:.1}s with 2 mirrors");
    assert!(with_mirrors < single_source * 0.7, "{with_mirrors:.1}s with mirrors vs {single_source:.1}s alone");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_dying_mirror_does_not_stop_the_download() {
    let size = 24 * MIB;
    let base = ServerConfig { size, rate_per_conn: 2 * MIB, ..Default::default() };
    let (a, b, c) = (serve(base.clone()).await, serve(base.clone()).await, serve(base.clone()).await);
    let dir = tempfile::tempdir().unwrap();
    let (engine, obs) = make_engine(dir.path());
    let mut req = request(a.url());
    req.connections = Some(6);
    req.mirrors = vec![b.url(), c.url()];
    let info = engine.add(req).await.unwrap();
    wait_percent(&engine, &info.id, 25).await;

    b.set_offline(true); // mirror B vanishes mid-download
    let done = wait_for(&engine, &info.id, "Completed", Duration::from_secs(90), |i| {
        i.state == DownloadState::Completed
    })
    .await;
    assert_eq!(common::sha256_file(&file_of(&done)), a.expected_sha256());
    assert!(!states_of(&obs, &info.id).contains(&DownloadState::Failed));
    // A and C picked up B's share.
    let (sa, sc) = (a.stats.bytes_sent.load(Ordering::SeqCst), c.stats.bytes_sent.load(Ordering::SeqCst));
    assert!(sa + sc > size * 3 / 4, "A + C served only {} of {size}", sa + sc);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn credentials_are_not_sent_to_a_mirror_on_another_origin() {
    let size = 8 * MIB;
    let a = serve(ServerConfig {
        size,
        auth: AuthMode::Basic { user: "alice".into(), pass: "s3cret".into() },
        ..Default::default()
    })
    .await;
    let b = serve(ServerConfig { size, ..Default::default() }).await; // a different origin (other port)
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());
    let mut req = request(a.url());
    req.http = HttpOptions {
        username: Some("alice".into()),
        password: Some("s3cret".into()),
        cookies: Some("sid=top-secret".into()),
        headers: vec![("X-Api-Key".into(), "key-123".into()), ("X-Plain".into(), "ok".into())],
        ..Default::default()
    };
    req.mirrors = vec![b.url()];
    let info = engine.add(req).await.unwrap();
    let done = wait_state(&engine, &info.id, DownloadState::Completed).await;
    assert_eq!(common::sha256_file(&file_of(&done)), a.expected_sha256());
    assert!(done.mirrors[0].ok, "{:?}", done.mirrors);

    let seen = |s: &TestServer, name: &str| {
        s.stats.headers.lock().unwrap().iter().any(|h| h.contains_key(name))
    };
    assert!(seen(&a, "authorization") && seen(&a, "x-api-key"), "the primary gets everything");
    assert!(b.stats.get_requests.load(Ordering::SeqCst) > 0, "the mirror was used");
    for secret in ["authorization", "cookie", "x-api-key"] {
        assert!(!seen(&b, secret), "mirror received the {secret} header meant for the primary site");
    }
    assert!(seen(&b, "x-plain"), "harmless headers still go along");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn mirrors_are_not_used_when_the_main_link_cannot_be_split() {
    let size = 4 * MIB;
    let a = serve(ServerConfig { size, ranges: false, ..Default::default() }).await;
    let b = serve(ServerConfig { size, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());
    let mut req = request(a.url());
    req.mirrors = vec![b.url()];
    let info = engine.add(req).await.unwrap();
    let done = wait_state(&engine, &info.id, DownloadState::Completed).await;
    assert_eq!(common::sha256_file(&file_of(&done)), a.expected_sha256());
    assert_eq!(b.stats.get_requests.load(Ordering::SeqCst), 0);
    assert!(!done.mirrors[0].ok && done.mirrors[0].reason.as_deref().unwrap().contains("split"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn bad_mirror_links_are_refused_when_adding() {
    let dir = tempfile::tempdir().unwrap();
    let (engine, obs) = make_engine(dir.path());
    let mut req = request("https://files.example.com/a.bin".into());
    req.start_paused = true;
    req.mirrors = vec!["not a link".into()];
    assert_eq!(engine.add(req.clone()).await.unwrap_err().code(), "invalid_url");
    req.mirrors = vec!["https://www.netflix.com/title/1".into()];
    assert_eq!(engine.add(req.clone()).await.unwrap_err().code(), "blocked");
    // Blank entries and the primary itself are ignored; duplicates collapse.
    req.mirrors = vec![
        " ".into(),
        "https://files.example.com/a.bin".into(),
        "https://m.example.com/a.bin".into(),
        "https://m.example.com/a.bin".into(),
    ];
    let info = engine.add(req).await.unwrap();
    let t = Instant::now();
    let stored = loop {
        if let Some(r) = obs.lock().unwrap().persisted.get(&info.id) {
            break r.mirrors.clone();
        }
        assert!(t.elapsed() < Duration::from_secs(5));
        tokio::time::sleep(Duration::from_millis(10)).await;
    };
    assert_eq!(stored, vec!["https://m.example.com/a.bin".to_string()]);
}

// ---------- HTTP/3 and Alt-Svc ---------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn when_quic_cannot_be_used_the_download_falls_back_to_tcp_quickly() {
    // Force an HTTP/3 attempt against a plain-TCP server: QUIC cannot work there, exactly like on a
    // network that blocks UDP. Every connection must silently end up on TCP, and fast.
    let size = 6 * MIB;
    let server = serve(ServerConfig {
        size,
        rate_per_conn: 4 * MIB,
        alt_svc: Some(r#"h3=":443"; ma=60"#.into()),
        ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let mut cfg = test_config(dir.path());
    cfg.http3 = flowget_engine::H3Plan::Force;
    let (engine, obs) = make_engine_with(cfg);
    let mut req = request(server.url());
    req.connections = Some(4);
    let t = Instant::now();
    let info = engine.add(req).await.unwrap();
    let done = wait_for(&engine, &info.id, "Completed", Duration::from_secs(25), |i| {
        i.state == DownloadState::Completed
    })
    .await;
    let secs = t.elapsed().as_secs_f64();
    assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256());
    assert!(secs < 12.0, "fallback took too long: {secs:.1}s");
    // The user sees what is really in use, and no error was ever raised.
    let last = obs.lock().unwrap().progress.iter().rev().find_map(|p| p.protocol.clone());
    assert_eq!(last.as_deref(), Some("HTTP/1.1"));
    assert!(!states_of(&obs, &info.id).contains(&DownloadState::Failed));
    println!("http3 fallback: finished in {secs:.1}s, protocol {last:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_http3_advertisement_on_plain_http_is_ignored() {
    // QUIC always carries TLS, so an Alt-Svc seen over http:// must not even trigger an attempt.
    let size = 4 * MIB;
    let server = serve(ServerConfig {
        size,
        alt_svc: Some(r#"h3=":443"; ma=60"#.into()),
        ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, obs) = make_engine(dir.path()); // default plan: Auto
    let t = Instant::now();
    let info = engine.add(request(server.url())).await.unwrap();
    let done = wait_state(&engine, &info.id, DownloadState::Completed).await;
    assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256());
    assert!(t.elapsed() < Duration::from_secs(8));
    let last = obs.lock().unwrap().progress.iter().rev().find_map(|p| p.protocol.clone());
    assert_eq!(last.as_deref(), Some("HTTP/1.1"));
}

/// Real-world check of the HTTP/3 path against a CDN that advertises it. Needs internet and UDP/443.
///   cargo test -p flowget-engine --release -- --ignored --nocapture real_http3
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "needs internet access and outbound UDP/443"]
async fn real_http3_download_from_a_cdn() {
    let url = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
    let dir = tempfile::tempdir().unwrap();
    let (engine, obs) = make_engine(dir.path()); // plan Auto: follows the server's Alt-Svc
    let t = Instant::now();
    let info = engine.add(request(url.to_string())).await.unwrap();
    let done = wait_for(&engine, &info.id, "Completed or Failed", Duration::from_secs(60), |i| {
        matches!(i.state, DownloadState::Completed | DownloadState::Failed)
    })
    .await;
    println!("state {:?}, error {:?}, {} bytes in {:.1}s", done.state, done.error, done.downloaded, t.elapsed().as_secs_f64());
    assert_eq!(done.state, DownloadState::Completed);
    assert!(done.total_size.unwrap_or(0) > 100_000);
    let proto = obs.lock().unwrap().progress.iter().rev().find_map(|p| p.protocol.clone());
    println!("protocol used: {proto:?}");
    assert_eq!(proto.as_deref(), Some("HTTP/3"), "the CDN advertises h3, so QUIC should have been used");
}

/// Diagnostic for the HTTP/3 path against a real CDN: what does the server advertise, and what happens
/// when we speak HTTP/3 to it directly?
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "needs internet access and outbound UDP/443"]
async fn diagnose_real_http3() {
    use flowget_engine::http::{send_with_auth, HttpSession, HEADER_TIMEOUT};
    use flowget_engine::probe::probe;
    let url = url::Url::parse("https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js").unwrap();
    let session = HttpSession::new(&HttpOptions::default(), &url);
    let p = probe(&session, &url).await.expect("probe");
    println!("probe: size {:?}, ranges {}, h3_port from Alt-Svc: {:?}", p.total_size, p.accepts_ranges, p.h3_port);

    // Raw view of the Alt-Svc header as sent over the normal (TCP) connection.
    let tcp = session.client().unwrap();
    let r = send_with_auth(&session, &tcp, reqwest::Method::HEAD, &url, None, HEADER_TIMEOUT, |rb| rb).await.unwrap();
    println!("TCP answer: {:?}, alt-svc = {:?}", r.version(), r.headers().get("alt-svc"));

    // Speak HTTP/3 directly and report the real outcome / error.
    match session.client_h3(None) {
        Err(e) => println!("could not even build the HTTP/3 client: {e:?}"),
        Ok(h3) => {
            let t = Instant::now();
            let r = send_with_auth(
                &session,
                &h3,
                reqwest::Method::GET,
                &url,
                None,
                Duration::from_secs(10),
                |rb| rb.version(reqwest::Version::HTTP_3).header("Range", "bytes=0-99"),
            )
            .await;
            match r {
                Ok(resp) => println!("HTTP/3 request OK after {:.2}s: {:?} {}", t.elapsed().as_secs_f64(), resp.version(), resp.status()),
                Err(e) => println!("HTTP/3 request FAILED after {:.2}s: {e:?}", t.elapsed().as_secs_f64()),
            }
        }
    }
}

// ---------- the acceptance test --------------------------------------------------------------

/// ACCEPTANCE TEST: download a 1 GB file with 8 connections, pause at 40%, close the app,
/// reopen it, resume, and the final checksum must match the original.
///
/// The "app" is two separate `Engine` instances sharing only the saved JSON record and the
/// file on disk, which is exactly what survives a real close/reopen.
#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
#[ignore = "1 GB; run with: cargo test -p flowget-engine --release -- --ignored --nocapture acceptance"]
async fn acceptance_1gb_pause_at_40_close_reopen_resume_checksum_matches() {
    let size = 1024 * MIB;
    let server = serve(ServerConfig {
        size,
        rate_per_conn: 16 * MIB, // 8 connections -> ~128 MiB/s, so 40% is hit after ~3 s
        ..Default::default()
    })
    .await;
    let seed = 1;
    let expected = tokio::task::spawn_blocking(move || common::sha256_hex_of_generated(seed, size)).await.unwrap();
    println!("expected SHA-256: {expected}");

    // Use the system temp dir (on C:) so the project drive is not filled up.
    let dir = tempfile::tempdir().unwrap();

    // ---- first app session ----
    let t0 = Instant::now();
    let (engine1, obs1) = make_engine(dir.path());
    let info = engine1.add(request(server.url())).await.unwrap(); // 8 connections
    assert_eq!(info.connections, 8);
    let paused_info = wait_percent(&engine1, &info.id, 40).await;
    println!("[timing] reached 40% after {:.1}s", t0.elapsed().as_secs_f64());
    let t_pause = Instant::now();
    engine1.pause(&info.id).await.unwrap();
    println!("[timing] pause() took {:.1}s (workers flushed + fsync)", t_pause.elapsed().as_secs_f64());
    let paused = engine1.info(&info.id).unwrap();
    let pct = paused.downloaded as f64 * 100.0 / size as f64;
    println!("paused at {pct:.1}% ({} of {} bytes; was {} when pause was requested)", paused.downloaded, size, paused_info.downloaded);
    assert!((40.0..60.0).contains(&pct), "paused at {pct:.1}%");

    println!("closing the app ...");
    engine1.shutdown().await;
    let record = obs1.lock().unwrap().persisted.get(&info.id).cloned().unwrap();
    assert_eq!(record.state, DownloadState::Paused);
    assert_eq!(record.downloaded, paused.downloaded);
    assert!(record.segments.len() >= 8);
    let json = serde_json::to_string(&record).unwrap();
    drop(engine1);

    // ---- second app session ----
    println!("reopening the app ...");
    let record: DownloadRecord = serde_json::from_str(&json).unwrap();
    let (engine2, _obs2) = make_engine(dir.path());
    engine2.restore(vec![record]);
    let restored = engine2.info(&info.id).unwrap();
    assert_eq!(restored.state, DownloadState::Paused);
    assert_eq!(restored.downloaded, paused.downloaded);

    let t_resume = Instant::now();
    engine2.resume(&info.id).await.unwrap();
    // Report how the resumed transfer progresses, to see where time goes.
    let watcher = {
        let engine2 = engine2.clone();
        let id = info.id.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(5)).await;
                if let Ok(i) = engine2.info(&id) {
                    println!(
                        "[timing] resume +{:.0}s: state={:?} {:.1}% speed={} MiB/s",
                        t_resume.elapsed().as_secs_f64(),
                        i.state,
                        i.downloaded as f64 * 100.0 / size as f64,
                        i.speed_bps / MIB
                    );
                }
            }
        })
    };
    // Generous timeout: on a slow disk (a few MiB/s sustained) 1 GiB legitimately takes minutes.
    let done = wait_for(&engine2, &info.id, "Completed", Duration::from_secs(1200), |i| {
        i.state == DownloadState::Completed
    })
    .await;
    watcher.abort();
    println!("[timing] resume to completed took {:.1}s", t_resume.elapsed().as_secs_f64());
    println!("completed; hashing the downloaded file ...");
    let path = file_of(&done);
    let actual = tokio::task::spawn_blocking(move || common::sha256_file(&path)).await.unwrap();
    println!("downloaded SHA-256: {actual}");
    assert_eq!(actual, expected, "checksum of the resumed file must match the original");
    assert_eq!(std::fs::metadata(file_of(&done)).unwrap().len(), size);
    assert_eq!(dir_entries(dir.path()).len(), 1, "no stray .part files");

    let sent = server.stats.bytes_sent.load(Ordering::SeqCst);
    println!("server sent {} MiB for a {} MiB file", sent / MIB, size / MIB);
}

// ---------- Phase 2, part 2: loss, AIMD, 429/503, Turbo Mode, DNS, disk writer ---------------------

/// Distinct values of `ProgressEvent::connections` seen for a download, in order.
fn connection_counts(obs: &Obs, id: &str) -> Vec<u32> {
    let mut out: Vec<u32> = Vec::new();
    for p in obs.lock().unwrap().progress.iter().filter(|p| p.id == id && p.connections > 0) {
        if out.last() != Some(&p.connections) {
            out.push(p.connections);
        }
    }
    out
}

/// ACCEPTANCE: a download completes correctly with 20 % simulated packet loss.
///
/// Model (see `ServerConfig::loss`): one in five 16 KiB blocks is "lost"; TCP hides that as a
/// retransmission delay, and some losses are worse (15 % of them reset the connection when the
/// retransmission timer gives up). On top of that, 1 % of blocks hit a random disconnect.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn acceptance_download_completes_correctly_with_20_percent_packet_loss() {
    let size = 12 * MIB + 99;
    let server = serve(ServerConfig {
        size,
        loss: 0.20,
        loss_delay_ms: 60,
        loss_reset_share: 0.15,
        random_disconnect: 0.01,
        ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());

    let info = engine.add(request(server.url())).await.unwrap();
    let done = wait_state(&engine, &info.id, DownloadState::Completed).await;

    assert_eq!(done.downloaded, size);
    assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256(), "file must be byte-exact");
    // The loss was real: connections were reset and reopened many times (8 would be a clean run).
    let gets = server.stats.get_requests.load(Ordering::SeqCst);
    assert!(gets >= 16, "expected many reconnects under loss, saw only {gets} GETs");
}

/// AIMD, additive increase: starts with 4 connections and adds one per interval while the total
/// speed keeps improving, up to the download's own count (8).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn aimd_starts_with_four_connections_and_adds_one_while_speed_grows() {
    let size = 56 * MIB;
    // Each connection is capped, so total speed really grows with the number of connections.
    let server = serve(ServerConfig { size, rate_per_conn: MIB, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let mut cfg = test_config(dir.path());
    cfg.aimd_start = 4;
    cfg.aimd_interval = Duration::from_millis(500);
    let (engine, obs) = make_engine_with(cfg);

    let info = engine.add(request(server.url())).await.unwrap(); // 8 connections requested
    wait_for(&engine, &info.id, "8 connections", Duration::from_secs(60), |i| i.downloaded > 0).await;
    wait_state(&engine, &info.id, DownloadState::Completed).await;

    let counts = connection_counts(&obs, &info.id);
    assert_eq!(counts.first(), Some(&4), "must start with 4 connections: {counts:?}");
    assert_eq!(counts.last(), Some(&8), "must reach the requested 8: {counts:?}");
    for w in counts.windows(2) {
        assert_eq!(w[1], w[0] + 1, "grows one connection at a time: {counts:?}");
    }
}

/// AIMD stops adding connections when they bring no gain (here the global limit caps total speed).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn aimd_stops_growing_when_extra_connections_do_not_help() {
    let size = 24 * MIB;
    let server = serve(ServerConfig { size, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let mut cfg = test_config(dir.path());
    cfg.aimd_start = 4;
    cfg.aimd_interval = Duration::from_millis(800);
    // The interval is shortened for test speed, and speed measured over 800 ms jitters by roughly
    // +/-12 %: with the default 5 % threshold a lucky rebound reads as "one more connection helped"
    // and growth never stops (observed: always [4, 5, 6, 7, 8] on a busy 4-core machine). A threshold
    // above the noise keeps this test about the stop logic rather than about measurement jitter.
    cfg.aimd_gain = 0.25;
    let (engine, obs) = make_engine_with(cfg);
    engine.set_global_speed_limit(4 * MIB); // the "line" is full no matter how many connections

    let info = engine.add(request(server.url())).await.unwrap();
    wait_state(&engine, &info.id, DownloadState::Completed).await;

    let counts = connection_counts(&obs, &info.id);
    assert_eq!(counts.first(), Some(&4));
    assert!(counts.last().copied().unwrap_or(0) <= 6, "extra connections do not help here: {counts:?}");
}

/// A 503 ("too many connections") halves the connection count, and the download still completes.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_503_halves_the_connection_count_and_the_download_still_completes() {
    let size = 16 * MIB;
    let server = serve(ServerConfig {
        size,
        rate_per_conn: 2 * MIB,
        max_concurrent: Some(3),
        busy_status: Some(503),
        ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let mut cfg = test_config(dir.path());
    cfg.halve_cooldown = Duration::from_millis(300);
    cfg.retry.max_server_retries = 40; // the refused connections keep trying until the count is right
    let (engine, obs) = make_engine_with(cfg);

    let info = engine.add(request(server.url())).await.unwrap(); // starts with 8
    let done = wait_state(&engine, &info.id, DownloadState::Completed).await;

    assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256());
    let counts = connection_counts(&obs, &info.id);
    assert_eq!(counts.first(), Some(&8));
    assert!(counts.iter().any(|&c| c <= 4), "503 must have cut the count in half at least once: {counts:?}");
    assert!(server.stats.refused.load(Ordering::SeqCst) > 0);
}

fn fake_adapter(id: &str, name: &str, ip: &str) -> flowget_engine::AdapterInfo {
    flowget_engine::AdapterInfo {
        id: id.into(),
        name: name.into(),
        kind: flowget_engine::AdapterKind::Other,
        ip: ip.parse().unwrap(),
    }
}

/// Turbo Mode: with two "networks" (two local addresses), connections are bound to both, the
/// server sees both source addresses, the file is intact and speed is reported per adapter.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn turbo_mode_spreads_connections_over_adapters_and_reports_speed_per_adapter() {
    let size = 24 * MIB + 5;
    let server = serve(ServerConfig { size, rate_per_conn: 2 * MIB, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let mut cfg = test_config(dir.path());
    cfg.turbo_mode = true;
    cfg.adapter_override = Some(vec![fake_adapter("a", "Wi-Fi", "127.0.0.2"), fake_adapter("b", "Ethernet", "127.0.0.3")]);
    let (engine, obs) = make_engine_with(cfg);

    let info = engine.add(request(server.url())).await.unwrap();
    let done = wait_state(&engine, &info.id, DownloadState::Completed).await;
    assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256());

    let peers = server.stats.peers.lock().unwrap().clone();
    let from = |ip: &str| peers.iter().filter(|p| p.to_string() == ip).count();
    assert!(from("127.0.0.2") >= 3, "connections via adapter 1: {peers:?}");
    assert!(from("127.0.0.3") >= 3, "connections via adapter 2: {peers:?}");

    // Per-adapter numbers in the progress events.
    let o = obs.lock().unwrap();
    let last = o.progress.iter().rev().find(|p| p.id == info.id && p.adapters.len() == 2).expect("adapter progress");
    let total: u64 = last.adapters.iter().map(|a| a.bytes).sum();
    assert!(last.adapters.iter().all(|a| a.bytes > size / 5), "both adapters carry real traffic: {:?}", last.adapters);
    assert!(total >= size * 99 / 100, "adapter byte counters add up to the file: {total} of {size}");
    assert!(o.progress.iter().any(|p| p.adapters.iter().any(|a| a.speed_bps > 0)), "speed per adapter was reported");
}

/// Turbo Mode off (or only one network): nothing is bound and the OS picks the route.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn without_turbo_mode_connections_are_not_bound_to_adapters() {
    let size = 6 * MIB;
    let server = serve(ServerConfig { size, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let mut cfg = test_config(dir.path());
    cfg.turbo_mode = false;
    cfg.adapter_override = Some(vec![fake_adapter("a", "Wi-Fi", "127.0.0.2"), fake_adapter("b", "Ethernet", "127.0.0.3")]);
    let (engine, obs) = make_engine_with(cfg);
    let info = engine.add(request(server.url())).await.unwrap();
    wait_state(&engine, &info.id, DownloadState::Completed).await;
    let peers = server.stats.peers.lock().unwrap().clone();
    assert!(peers.iter().all(|p| p.to_string() == "127.0.0.1"), "no binding expected: {peers:?}");
    assert!(obs.lock().unwrap().progress.iter().all(|p| p.adapters.is_empty()));

    // One adapter only: still nothing to bond.
    let dir2 = tempfile::tempdir().unwrap();
    let mut cfg = test_config(dir2.path());
    cfg.turbo_mode = true;
    cfg.adapter_override = Some(vec![fake_adapter("a", "Wi-Fi", "127.0.0.2")]);
    let (engine, _obs) = make_engine_with(cfg);
    let before = server.stats.peers.lock().unwrap().len();
    let info = engine.add(request(server.url())).await.unwrap();
    wait_state(&engine, &info.id, DownloadState::Completed).await;
    let peers = server.stats.peers.lock().unwrap().clone();
    assert!(peers[before..].iter().all(|p| p.to_string() == "127.0.0.1"), "a single network is not bonded");
}

/// An adapter that cannot connect (unplugged tether) is benched; the others finish the download.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_dead_adapter_is_benched_and_the_other_network_finishes_the_download() {
    let size = 12 * MIB;
    let server = serve(ServerConfig { size, rate_per_conn: 4 * MIB, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let mut cfg = test_config(dir.path());
    cfg.turbo_mode = true;
    // 192.0.2.x (TEST-NET-1) is not an address of this machine: binding to it fails.
    cfg.adapter_override = Some(vec![fake_adapter("dead", "Unplugged", "192.0.2.77"), fake_adapter("ok", "Ethernet", "127.0.0.3")]);
    let (engine, obs) = make_engine_with(cfg);
    let info = engine.add(request(server.url())).await.unwrap();
    let done = wait_state(&engine, &info.id, DownloadState::Completed).await;
    assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256());
    let o = obs.lock().unwrap();
    if let Some(last) = o.progress.iter().rev().find(|p| p.id == info.id && p.adapters.len() == 2) {
        let ok = last.adapters.iter().find(|a| a.id == "ok").unwrap();
        assert!(ok.bytes >= size * 99 / 100, "the working adapter carried the file: {:?}", last.adapters);
    }
}

/// DNS: a hostname that resolves to IPv6 first (`::1`, nothing listens there) and IPv4 second
/// still downloads (Happy Eyeballs), and eight connections cause a single lookup (cache).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn hostname_downloads_use_the_dns_cache_and_fall_back_between_address_families() {
    let size = 8 * MIB;
    let server = serve(ServerConfig { size, rate_per_conn: 4 * MIB, ..Default::default() }).await;
    let port = server.addr.port();
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());
    let lookups_before = flowget_engine::dns::DnsCache::global().stats.lookups.load(Ordering::SeqCst);

    let info = engine.add(request(format!("http://localhost:{port}/file.bin"))).await.unwrap();
    let done = wait_state(&engine, &info.id, DownloadState::Completed).await;
    assert_eq!(common::sha256_file(&file_of(&done)), server.expected_sha256());

    let lookups = flowget_engine::dns::DnsCache::global().stats.lookups.load(Ordering::SeqCst) - lookups_before;
    assert!(lookups <= 2, "eight connections must share one DNS answer, but {lookups} lookups were made");
}

/// Disk: progress is persisted about every 2 seconds (not on every block, not every second).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn progress_is_persisted_every_two_seconds_by_default() {
    assert_eq!(EngineConfig::new(PathBuf::new()).checkpoint_interval, Duration::from_secs(2));

    let size = 12 * MIB;
    let server = serve(ServerConfig { size, rate_per_conn: 512 * KIB, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let mut cfg = test_config(dir.path());
    cfg.checkpoint_interval = Duration::from_secs(2); // production value
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let stamps: Arc<Mutex<Vec<Instant>>> = Arc::new(Mutex::new(Vec::new()));
    let s2 = stamps.clone();
    tokio::spawn(async move {
        while let Some(ev) = rx.recv().await {
            match ev {
                EngineEvent::Persist(_) => s2.lock().unwrap().push(Instant::now()),
                EngineEvent::Flush(t) => {
                    let _ = t.send(());
                }
                _ => {}
            }
        }
    });
    let engine = Engine::new(cfg, tx);
    let mut req = request(server.url());
    req.connections = Some(4);
    let t0 = Instant::now();
    let info = engine.add(req).await.unwrap();
    wait_state(&engine, &info.id, DownloadState::Completed).await;
    let t1 = Instant::now();

    // Persists strictly inside the download (start/finish state changes persist too).
    let inside: Vec<Instant> =
        stamps.lock().unwrap().iter().copied().filter(|t| *t > t0 + Duration::from_millis(600) && *t + Duration::from_millis(600) < t1).collect();
    assert!(inside.len() >= 2, "a download of several seconds must be persisted periodically ({} seen)", inside.len());
    for w in inside.windows(2) {
        let gap = w[1] - w[0];
        assert!(gap >= Duration::from_millis(1700), "persisted too often: {gap:?} between checkpoints");
        assert!(gap <= Duration::from_millis(4500), "persisted too rarely: {gap:?} between checkpoints");
    }
}

/// STRESS: 50 downloads added at the same moment (4 connections each, so up to 200 sockets) all
/// complete, every file is byte-exact, names do not collide and no temporary files are left behind.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn fifty_parallel_downloads_all_complete_byte_exact() {
    const COUNT: usize = 50;
    let size = 2 * MIB + 3;
    // Each connection is slow (256 KiB/s) so the downloads genuinely overlap instead of finishing
    // one after another.
    let server = serve(ServerConfig { size, rate_per_conn: 256 * KIB, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());

    let mut ids = Vec::new();
    for _ in 0..COUNT {
        let info = engine
            .add(AddRequest { url: server.url(), connections: Some(4), ..Default::default() })
            .await
            .unwrap();
        ids.push(info.id);
    }

    let expected = server.expected_sha256();
    let mut names = std::collections::HashSet::new();
    for id in &ids {
        let done = wait_state(&engine, id, DownloadState::Completed).await;
        assert_eq!(done.downloaded, size, "download {id} is incomplete");
        let path = file_of(&done);
        assert_eq!(std::fs::metadata(&path).unwrap().len(), size);
        assert_eq!(common::sha256_file(&path), expected, "download {id} is corrupt");
        assert!(names.insert(path), "two downloads were given the same file");
    }

    let entries = dir_entries(dir.path());
    assert_eq!(entries.len(), COUNT, "expected exactly {COUNT} files, found: {entries:?}");
    let peak = server.stats.peak_connections.load(Ordering::SeqCst);
    println!("50 parallel downloads OK: peak simultaneous server connections = {peak}");
    assert!(peak >= COUNT, "the downloads did not really run in parallel (peak {peak})");
}

/// Downloads finished outside the engine (yt-dlp videos) are registered with `restore`: they must
/// appear in the list and be removable from the UI, and removing must keep the file by default.
#[tokio::test]
async fn restored_finished_item_is_listed_and_removable() {
    let dir = tempfile::tempdir().unwrap();
    let (engine, _obs) = make_engine(dir.path());
    let file = dir.path().join("video.mkv");
    std::fs::write(&file, b"video-bytes").unwrap();
    let rec = flowget_engine::DownloadRecord {
        id: "yt-1".into(),
        url: "https://youtu.be/abc".into(),
        final_url: None,
        save_dir: dir.path().to_string_lossy().to_string(),
        file_name: "video.mkv".into(),
        file_name_locked: true,
        file_path: file.to_string_lossy().to_string(),
        total_size: Some(11),
        downloaded: 11,
        resume_supported: Some(false),
        mime: Some("video/x-matroska".into()),
        etag: None,
        last_modified: None,
        segments: Vec::new(),
        connections: 1,
        speed_limit: 0,
        http: Default::default(),
        checksum: None,
        checksum_verified: None,
        mirrors: Vec::new(),
        mirror_report: Vec::new(),
        state: DownloadState::Completed,
        error: None,
        created_at: 1,
        completed_at: Some(2),
        category: Some("Videos".into()),
        queue_id: None,
        queue_order: None,
        interrupted: false,
    };
    engine.restore(vec![rec]);
    let listed = engine.list();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].state, DownloadState::Completed);

    engine.remove("yt-1", false).await.expect("remove should find the restored item");
    assert!(engine.list().is_empty());
    assert!(file.exists(), "file must be kept when delete_file is false");
}
