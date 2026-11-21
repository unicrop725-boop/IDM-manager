# Benchmarks and measurements (Phase 9)

Everything in this file was measured on the machine below on 2026-11-21 unless it says otherwise.
Earlier versions of this file contained timings against IDM, hotspot results and memory figures that were
not backed by any measurement; they have been removed. Section 6 lists what has **not** been measured.

## Test machine

| | |
|---|---|
| OS | Windows 10 Pro (build 19045) |
| CPU | Intel Core i5-7400, 4 cores / 4 threads, 3.0 GHz |
| RAM | 48 GB |
| Network | One Wi-Fi adapter (Realtek 8822CE, 802.11ac); no second adapter |
| Other load | The machine was in normal use (browsers, editor, Windows Defender). Timing tests were repeated on a quiet machine where a result looked load-sensitive. |
| Build | `cargo build --release` (thin LTO), WebView2 157.0 |

Network behaviour in sections 1 to 3 comes from a local test server that misbehaves in a reproducible way
(caps, silence, dropped connections, outages), not from a real WAN.

## 1. Engine vs. simple strategies, bad-network scenarios

`cargo run --release -p flowget-engine --example bench -- --runs 3`. Median time to receive the whole
file over 3 runs (min-max in brackets, lower is better). "8 fixed" is a plain segmented downloader: 8
connections, fixed segments, ordinary retry. **It is not IDM.** Every file was verified against the
expected SHA-256.

| Scenario | single connection | 8 fixed connections | adaptive (FlowGet) | adaptive vs 8 fixed |
|---|---|---|---|---|
| A. Healthy server, each connection capped at 4 MiB/s (32 MiB) | 14.6 s | 3.7 s | 3.4 s | 1.1x faster |
| B. One slow connection (256 KiB/s) | 14.4 s | 16.5 s | 5.5 s | 3.0x faster |
| C. A connection goes silent | 15.3 s | 32.0 s | 4.0 s | 8.0x faster |
| D. Server tolerates only 3 connections | 14.6 s | 9.2 s | 6.2 s | 1.5x faster |
| E. Flaky link (responses cut every 1 MiB, 16 MiB) | 9.5 s | 2.1 s | 2.2 s | about equal |
| F. 5-second internet outage | 21.9 s | 10.7 s | 11.5 s | **0.9x (slightly slower)** |
| G. 30-second internet outage | 70.3 s | 61.4 s | 36.6 s | 1.7x faster |

Extra data the server had to send was at most 1% over the file size in every case.

What this supports: work stealing and stall detection make a large difference when one connection is slow
or dead (B, C), and the network supervisor roughly halves recovery from a long outage (G). It does not
show a gain on a healthy link (A) or a short outage (F).

## 2. Hard kill ("power cut") and resume

Real separate processes (`examples/killtest.rs`): a downloader persisting its records to disk is killed
with `taskkill /F`, then a fresh process restores only that record and the partial file and resumes.

* 256 MiB file, killed at 41.6%. The last durable record said 85,327,872 bytes (31.8%).
* The fresh process resumed and finished. **SHA-256 matched the server's value.**

Also passing: the 1 GiB acceptance test (pause at 40.5%, close, reopen, resume: checksum matches), the
30-second network-cut test (resumed 0.32 s after the link returned), and the in-process crash test.

Limit: a process kill leaves the operating system's file buffers intact. A real loss of power (buffers
not flushed) was **not** tested.

## 3. 50 parallel downloads

`fifty_parallel_downloads_all_complete_byte_exact`: 50 downloads of 2 MiB added at once, 4 connections
each, server limited to 256 KiB/s per connection so they genuinely overlap. All 50 completed byte-exact,
got 50 distinct file names, left no temporary files; the server saw **200 simultaneous connections**.

The engine itself has no global cap on simultaneous downloads or sockets; limiting concurrency is done
by queues (*Max Concurrent*).

## 4. Memory and CPU (real app, real process tree)

`flowget.exe` plus its six Microsoft Edge WebView2 processes, sampled once a second for 30 to 40 s after
a 25 s settle. "Working set" counts shared pages the way Task Manager does; "private" does not.

| State | `flowget.exe` alone | Whole app, working set | Whole app, private | CPU (of 4 cores) |
|---|---|---|---|---|
| Idle, 1 download in the list | 25 MB | 342 MB | 138 MB | 0.06% |
| Idle, 10,001 downloads in the list | 41 MB | 367 MB | 167 MB | 1.7% |

**Requirement "idle under 80 MB": met by the Rust process alone (25 MB), not met by the app as a user
sees it** (342 MB working set, 138 MB private), because the WebView2 processes are most of it.

CPU **while downloading** was measured for the download engine in its own process, driving the same
engine code, against the local server (the real window could not be driven safely, see section 6):

| Throughput | CPU, % of all 4 cores | CPU, % of one core | RAM |
|---|---|---|---|
| 69 Mbit/s | 0.41% | 1.6% | 26 MB |
| 113 Mbit/s | 0.51% | 2.1% | 27 MB |
| 219 Mbit/s | 0.76% | 3.0% | 38 MB |

**Requirement "under 5% CPU while downloading": met for the engine**, with margin, even counting against
a single core. It excludes the cost of drawing the window during a download, which was not measured.

## 5. List scale: 10,000 items

Interface only (mock data, no Rust backend), headless Chrome, `?stress=N` test hook:

| Rows | First row | DOM rows drawn | JS heap | Scroll to end | Sort | Search | Main-thread stalls > 100 ms |
|---|---|---|---|---|---|---|---|
| 10,000 | 437 ms | 21 | 7.7 MB (12.7 MB after sort/search) | 44 ms | 73 ms | 377 ms (includes typing) | none |
| 50,000 | 1.4 s | 21 | 55 MB (236 MB after) | 0.5 s | 0.9 s | 4.6 s | 8, up to 254 ms |

The table is virtualized, so 10,000 rows is comfortable; 50,000 is where search and sort start to hurt.
The real app with 10,001 rows in its database started and idled normally (section 4).

## 6. Not measured

| Item | Why not |
|---|---|
| **Comparison with IDM** (4 network conditions x 100 MB / 1 GB / 5 GB) | IDM is installed here but cannot be driven reliably or non-intrusively from a script, and the conditions below could not be produced. No IDM figure in this repository is a measurement. |
| **Turbo Mode** (Wi-Fi + hotspot) | The machine has one network adapter. The binding code exists (connections are bound to an adapter's local address) but its speed-up is unmeasured. |
| **Real slow-3G / lossy / unstable WAN** | No network shaper (Clumsy, netem, a router) was available. Sections 1 to 3 use a misbehaving local server instead, which is reproducible but not the same thing. |
| **5 GB files** | Disk write speed on this machine and the time budget; the largest real runs were 1 GiB (acceptance) and 256 MiB (hard kill). |
| **CPU of the window during a download** | The only way to start a download in the real app is through its window; automating that by keystrokes risked sending input to other windows, so it was not done. |
| **Real power loss** | See section 2. |

### How to run the IDM comparison yourself

```powershell
cd D:\I-Download\src-tauri
# Terminal 1: a test server. --rate-mb is per connection and must be an integer; 0 = unlimited.
cargo run --release -p flowget-engine --example testserver -- --size-mb 1024 --rate-mb 2
# It prints the URL and the expected SHA-256.
```

Download the printed URL in FlowGet and in IDM with a stopwatch (same save drive, same connection count),
then compare `Get-FileHash <file> -Algorithm SHA256` with the printed value. For a bad-network condition,
put a shaper such as Clumsy between the machine and the real internet and use a real file instead of the
local server.

## 7. Test suite

`cargo test --workspace --release`: **207 passed, 0 failed**, 5 ignored. Of those, the two long acceptance
tests (1 GiB pause/resume, 30-second network cut) were run separately and passed; the other three need
internet access or outbound UDP (`real_http3`, `diagnose_real_http3`, one connectivity test in
`netwatch.rs`) and were not run.
Before this phase the root crate's tests could not even start on Windows (missing Common Controls
manifest; fixed in `build.rs`), and two engine tests failed: an AIMD connection-growth test (fixed in the
engine and the test) and a QUIC-fallback test that is timing-sensitive under load (passes on a quiet
machine).
