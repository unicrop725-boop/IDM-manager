//! Benchmark: single connection vs 8 fixed connections vs the adaptive Phase 2 engine.
//!
//!   cargo run --release -p flowget-engine --example bench -- --runs 3 --out bench-results.md
//!
//! Every scenario is a local test server (see `tests/common/mod.rs`) that misbehaves in a
//! reproducible way: per-connection speed caps, one slow connection, a connection that goes silent,
//! a server that only tolerates a few simultaneous connections, a link that drops connections, and a
//! complete internet outage. Each (scenario, mode) pair is run `--runs` times; the table shows the
//! median, with min-max in brackets. Time is measured until the last byte has been received (the
//! final fsync / checksum are disk work and are not what is being compared); the downloaded file is
//! always verified against the expected SHA-256.
//!
//! Modes
//! * `single`    1 connection, nothing adaptive.
//! * `fixed-8`   8 connections cut into 8 fixed segments. No work stealing, no stall detection, no
//!               connection-count adaptation, no network supervisor. (Plain exponential-backoff retry.)
//! * `adaptive`  8 connections with everything from Phase 2: work stealing, stall detection,
//!               halving on failures, and the network supervisor.

#[path = "../tests/common/mod.rs"]
mod common;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use common::{ServerConfig, Trouble, TroubleKind};
use flowget_engine::{AddRequest, Connectivity, DownloadState, Engine, EngineConfig};
use futures_util::future::BoxFuture;
use tokio::sync::Notify;

const MIB: u64 = 1024 * 1024;
const KIB: u64 = 1024;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Single,
    Fixed8,
    Adaptive,
}

impl Mode {
    const ALL: [Mode; 3] = [Mode::Single, Mode::Fixed8, Mode::Adaptive];
    fn label(self) -> &'static str {
        match self {
            Mode::Single => "single connection",
            Mode::Fixed8 => "8 fixed connections",
            Mode::Adaptive => "adaptive (Phase 2)",
        }
    }
}

struct Scenario {
    name: &'static str,
    what: &'static str,
    size: u64,
    server: fn() -> ServerConfig,
    /// Internet outage of this length, starting when 25 % has been downloaded.
    outage: Option<Duration>,
}

fn scenarios() -> Vec<Scenario> {
    vec![
        Scenario {
            name: "A. Healthy server, per-connection speed cap",
            what: "Every connection is capped at 4 MiB/s (a common CDN behaviour). 32 MiB file.",
            size: 32 * MIB,
            server: || ServerConfig { size: 32 * MIB, rate_per_conn: 4 * MIB, ..Default::default() },
            outage: None,
        },
        Scenario {
            name: "B. One slow connection",
            what: "As A, but the segment starting at 12 MiB is served at only 256 KiB/s.",
            size: 32 * MIB,
            server: || ServerConfig {
                size: 32 * MIB,
                rate_per_conn: 4 * MIB,
                trouble: vec![Trouble { start: 12 * MIB, kind: TroubleKind::Slow(256 * KIB), once: false }],
                ..Default::default()
            },
            outage: None,
        },
        Scenario {
            name: "C. A connection goes silent",
            what: "As A, but the segment at 12 MiB sends 1 MiB and then stops, keeping the connection open.",
            size: 32 * MIB,
            server: || ServerConfig {
                size: 32 * MIB,
                rate_per_conn: 4 * MIB,
                trouble: vec![Trouble { start: 12 * MIB, kind: TroubleKind::StallAfter(MIB), once: true }],
                ..Default::default()
            },
            outage: None,
        },
        Scenario {
            name: "D. Server tolerates only 3 connections",
            what: "As A, but connections beyond 3 simultaneous transfers are dropped.",
            size: 32 * MIB,
            server: || ServerConfig {
                size: 32 * MIB,
                rate_per_conn: 4 * MIB,
                max_concurrent: Some(3),
                ..Default::default()
            },
            outage: None,
        },
        Scenario {
            name: "E. Flaky link",
            what: "As A on 16 MiB, but every response is cut after 1 MiB, forcing reconnects.",
            size: 16 * MIB,
            server: || ServerConfig {
                size: 16 * MIB,
                rate_per_conn: 4 * MIB,
                max_bytes_per_response: Some(MIB),
                ..Default::default()
            },
            outage: None,
        },
        Scenario {
            name: "F. 5-second internet outage",
            what: "As A, but the whole internet disappears for 5 s once 25 % is downloaded.",
            size: 32 * MIB,
            server: || ServerConfig { size: 32 * MIB, rate_per_conn: 4 * MIB, ..Default::default() },
            outage: Some(Duration::from_secs(5)),
        },
        Scenario {
            name: "G. 30-second internet outage",
            what: "As F, but the outage lasts 30 s. Plain backoff retries at ~0.1, 2, 6, 14, 30 s and then not until ~62 s.",
            size: 32 * MIB,
            server: || ServerConfig { size: 32 * MIB, rate_per_conn: 4 * MIB, ..Default::default() },
            outage: Some(Duration::from_secs(30)),
        },
    ]
}

/// A controllable "internet" for the adaptive mode's network supervisor.
struct FakeNet {
    up: AtomicBool,
    changed: Notify,
}

impl Connectivity for FakeNet {
    fn check(&self) -> BoxFuture<'_, bool> {
        Box::pin(async move { self.up.load(Ordering::SeqCst) })
    }
    fn changed(&self) -> BoxFuture<'_, ()> {
        Box::pin(async move { self.changed.notified().await })
    }
}

fn config(dir: &std::path::Path, mode: Mode) -> EngineConfig {
    let mut c = EngineConfig::new(dir.to_path_buf()); // production defaults (1 s backoff, 3 s stall, ...)
    if mode != Mode::Adaptive {
        c.work_stealing = false;
        c.stall_zero_after = Duration::from_secs(3600);
        c.stall_slow_after = Duration::from_secs(3600);
        c.fail_threshold = usize::MAX;
    }
    c
}

struct Sample {
    secs: f64,
    sent_ratio: f64,
}

async fn run_once(sc: &Scenario, mode: Mode) -> Result<Sample, String> {
    let server = common::spawn((sc.server)(), "127.0.0.1:0").await;
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    tokio::spawn(async move { while rx.recv().await.is_some() {} });
    let net = Arc::new(FakeNet { up: AtomicBool::new(true), changed: Notify::new() });
    let engine = Engine::with_connectivity(config(dir.path(), mode), tx, net.clone());
    if mode == Mode::Adaptive {
        let e = engine.clone();
        tokio::spawn(async move { e.run_network_monitor().await });
    }

    let connections = if mode == Mode::Single { 1 } else { 8 };
    let t0 = Instant::now();
    let info = engine
        .add(AddRequest { url: server.url(), connections: Some(connections), ..Default::default() })
        .await
        .map_err(|e| e.user_message())?;

    let poll = || tokio::time::sleep(Duration::from_millis(10));
    let deadline = Duration::from_secs(150);

    if let Some(outage) = sc.outage {
        while engine.info(&info.id).map(|i| i.downloaded * 4 < sc.size).unwrap_or(false) {
            if t0.elapsed() > deadline {
                return Err("timed out before the outage".into());
            }
            poll().await;
        }
        server.set_offline(true);
        net.up.store(false, Ordering::SeqCst);
        net.changed.notify_one();
        tokio::time::sleep(outage).await;
        let back = Instant::now();
        server.set_offline(false);
        net.up.store(true, Ordering::SeqCst);
        net.changed.notify_one();
        // How long until data flows again? (Diagnostic, printed to stderr.)
        let before = engine.info(&info.id).map(|i| i.downloaded).unwrap_or(0);
        while engine.info(&info.id).map(|i| i.downloaded <= before).unwrap_or(false) {
            if back.elapsed() > Duration::from_secs(60) {
                break;
            }
            poll().await;
        }
        eprintln!(
            "      (outage over: data flowing again after {:.2}s; whole download so far {:.2}s)",
            back.elapsed().as_secs_f64(),
            t0.elapsed().as_secs_f64()
        );
    }

    loop {
        let i = engine.info(&info.id).map_err(|e| e.user_message())?;
        if i.downloaded >= sc.size {
            break;
        }
        if i.state == DownloadState::Failed {
            return Err(format!("failed: {:?}", i.error.map(|e| e.message)));
        }
        if t0.elapsed() > deadline {
            return Err("did not finish in 150 s".into());
        }
        poll().await;
    }
    let secs = t0.elapsed().as_secs_f64();

    // Let it finish (fsync, size check) and make sure the bytes are right.
    let done = loop {
        let i = engine.info(&info.id).map_err(|e| e.user_message())?;
        match i.state {
            DownloadState::Completed => break i,
            DownloadState::Failed => return Err(format!("failed at the end: {:?}", i.error.map(|e| e.message))),
            _ => {}
        }
        if t0.elapsed() > Duration::from_secs(300) {
            return Err("did not complete".into());
        }
        poll().await;
    };
    let actual = common::sha256_file(std::path::Path::new(&done.file_path));
    if actual != server.expected_sha256() {
        return Err("CHECKSUM MISMATCH".into());
    }
    let sent = server.stats.bytes_sent.load(Ordering::SeqCst) as f64;
    Ok(Sample { secs, sent_ratio: sent / sc.size as f64 })
}

fn median(v: &mut [f64]) -> f64 {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[v.len() / 2]
}

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let runs: usize = arg(&args, "--runs").and_then(|v| v.parse().ok()).unwrap_or(3).max(1);
    let only = arg(&args, "--only"); // e.g. --only B
    let out_path = arg(&args, "--out");

    let mut table = String::new();
    table.push_str("| Scenario | single connection | 8 fixed connections | adaptive (Phase 2) | adaptive vs 8 fixed |\n");
    table.push_str("|---|---|---|---|---|\n");
    let mut overhead = String::new();
    overhead.push_str("| Scenario | single | 8 fixed | adaptive |\n|---|---|---|---|\n");
    let mut all_verified = true;

    for sc in scenarios() {
        if only.as_deref().is_some_and(|o| !sc.name.starts_with(o)) {
            continue;
        }
        eprintln!("== {} ==", sc.name);
        let mut cells = Vec::new();
        let mut medians = Vec::new();
        let mut ratios = Vec::new();
        for mode in Mode::ALL {
            let mut secs = Vec::new();
            let mut sent = Vec::new();
            let mut error = None;
            for r in 0..runs {
                match run_once(&sc, mode).await {
                    Ok(s) => {
                        eprintln!("   {:<20} run {}: {:>6.2}s  (server sent {:.2}x the file)", mode.label(), r + 1, s.secs, s.sent_ratio);
                        secs.push(s.secs);
                        sent.push(s.sent_ratio);
                    }
                    Err(e) => {
                        eprintln!("   {:<20} run {}: ERROR {e}", mode.label(), r + 1);
                        all_verified = false;
                        error = Some(e);
                        break;
                    }
                }
            }
            if let Some(e) = error {
                cells.push(format!("**{e}**"));
                medians.push(f64::NAN);
                ratios.push("-".to_string());
            } else {
                let (min, max) = (secs.iter().cloned().fold(f64::MAX, f64::min), secs.iter().cloned().fold(0.0, f64::max));
                let m = median(&mut secs);
                cells.push(format!("{m:.1} s ({min:.1}-{max:.1})"));
                medians.push(m);
                ratios.push(format!("{:.2}x", median(&mut sent)));
            }
        }
        let speedup = if medians[1].is_nan() || medians[2].is_nan() {
            "-".to_string()
        } else {
            format!("{:.1}x faster", medians[1] / medians[2])
        };
        table.push_str(&format!("| {} | {} | {} | {} | {} |\n", sc.name, cells[0], cells[1], cells[2], speedup));
        overhead.push_str(&format!("| {} | {} | {} | {} |\n", sc.name, ratios[0], ratios[1], ratios[2]));
    }

    let mut report = String::new();
    report.push_str(&format!("Median time to receive the whole file over {runs} run(s), min-max in brackets (lower is better).\n\n"));
    report.push_str(&table);
    report.push_str("\nData the server had to send, relative to the file size (1.00x = nothing wasted):\n\n");
    report.push_str(&overhead);
    report.push_str(&format!(
        "\nEvery downloaded file was checked against the expected SHA-256: {}.\n",
        if all_verified { "all matched" } else { "SOME RUNS FAILED, see above" }
    ));
    println!("\n{report}");
    if let Some(p) = out_path {
        std::fs::write(&p, &report).expect("write results");
        eprintln!("results written to {p}");
    }
}
