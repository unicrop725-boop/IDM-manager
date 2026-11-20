# Benchmarks

How the download engine behaves on slow and unstable connections, measured against two simpler strategies.
Every number below was produced by `bench` (see [Reproduce](#reproduce)); nothing is estimated.

## What this does and does not show

* It compares **three strategies inside this engine**:
  * **single connection**: one connection, nothing adaptive;
  * **8 fixed connections**: the file cut into 8 fixed segments with plain exponential-backoff retry. This is the classic
    "segmented downloader" design that most download managers use;
  * **adaptive (Phase 2)**: 8 connections with work stealing, stall detection, connection-count adaptation, fast reconnect and
    the network supervisor ("Waiting for network").
* It does **not** measure Internet Download Manager. IDM is closed-source commercial software and cannot be run or
  scripted here, so "faster than IDM" is not claimed. "8 fixed connections" is the nearest honest stand-in for a classic
  static-segment downloader, and where a result would differ for IDM specifically we do not know.
* The servers are **local and simulated**, so the misbehaviour is exactly reproducible (a slow connection, a connection that goes
  silent, a server that refuses extra connections, a link that drops, an internet outage). Real networks are messier; these
  scenarios show *mechanisms* and are not a prediction of your line speed. HTTP/3 and mirrors were verified for correctness and
  tested separately (below), not folded into these timings.

## Method

* Local test server (`tests/common/mod.rs`) serving a generated file; no real network is involved, so results do not depend on
  your internet speed.
* The server caps **each connection** (a very common CDN behaviour, and the reason multiple connections help at all). The nominal cap
  is 4 MiB/s, but because of Windows timer granularity in the test server the effective cap is about **2.3 MiB/s per connection**
  (32 MiB / 14 s for a single connection). This affects every mode equally.
* Time = until the **last byte has been received**. The final `fsync` and checksum are disk work and are excluded, because this
  PC's disk sustains only about 16 MiB/s and would otherwise dominate. Every downloaded file is checked against the expected
  SHA-256 afterwards; all runs matched.
* 3 runs per cell (G: 2 runs), the table shows the **median** with min-max in brackets.
* Production defaults throughout: 1 s base backoff capped at 60 s, 3 s stall limit, 8 connections.
* Machine: Windows 10, 4 logical cores, local loopback networking. Occasional outliers (one 40 s run of a single connection in D,
  one 19 s run in F) come from this PC's disk stalling; the median is used for that reason.

## Results

Median time to receive the whole file (lower is better). "adaptive vs 8 fixed" is `8 fixed / adaptive`.

| Scenario | single connection | 8 fixed connections | adaptive (Phase 2) | adaptive vs 8 fixed |
|---|---|---|---|---|
| A. Healthy server, 2.3 MiB/s per connection (32 MiB) | 15.1 s (14.7-15.2) | 1.9 s (1.9-2.1) | 2.1 s (1.8-2.7) | **0.9x (about equal)** |
| B. One slow connection (256 KiB/s on one segment) | 15.5 s (15.3-15.5) | 16.6 s (16.5-16.9) | 3.7 s (3.7-3.7) | **4.5x faster** |
| C. A connection goes silent (stops sending, stays open) | 15.3 s (15.1-15.4) | 32.0 s (32.0-32.2) | 3.7 s (3.7-3.7) | **8.7x faster** |
| D. Server tolerates only 3 simultaneous connections | 15.4 s (15.2-40.7) | 9.5 s (8.8-9.7) | 7.1 s (6.7-7.4) | **1.3x faster** |
| E. Flaky link (every response cut after 1 MiB), 16 MiB | 9.7 s (9.5-9.7) | 1.1 s (1.1-1.2) | 1.1 s (1.0-1.1) | **1.0x (equal)** |
| F. 5-second internet outage | 21.5 s (20.8-21.7) | 8.7 s (8.6-9.0) | 8.9 s (8.6-19.2) | **1.0x (equal)** |
| G. 30-second internet outage | 70.6 s (46.1-70.6) | 66.0 s (65.6-66.0) | 33.8 s (33.6-33.8) | **2.0x faster** |

Rows A-D come from one run of the final engine; E, F and G were run again after two fixes described below (the fixes do not
touch the code paths A-D exercise). The data the server had to send was 1.00x the file size in every cell, except 1.01x
for adaptive in B and C: stealing a range cuts a connection mid-response, so a few kilobytes in flight are discarded.

### Reading the results honestly

* **Where it wins big (B, C):** with fixed segments the whole download waits for the slowest connection. A slow connection (B)
  or a silently dead one (C, which a fixed design only notices after its 30 s read timeout) dictates the total time. Work
  stealing hands the slow segment's remaining bytes to connections that have finished, and stall detection closes and reopens a
  silent connection after 3 s.
* **30-second outage (G):** plain backoff retries after 0.1, 2, 6, 14 and 30 s and then not again until about 62 s, so it
  loses roughly 30 s after the connection is back. The network supervisor parks the download and resumes about half a
  second after connectivity returns. The shorter 5 s outage (F) shows no difference because plain backoff happens to
  retry at about 6 s; the benefit depends on how an outage lines up with the backoff schedule, and it grows with the length of the
  outage.
* **Modest (D):** connections beyond the server's limit are refused; halving the count converges, but it takes a few
  seconds, so the gain is 1.3x and not more. Mirrors (below) are the stronger remedy for per-server limits.
* **No gain on a healthy server (A):** all adaptive machinery is idle, and the median is within noise of the fixed design
  (2.1 s vs 1.9 s; the adaptive runs ranged 1.8-2.7 s). There is no claim that it is faster here.
* **Single connection** is included to show why connections matter at all: about 8x slower than 8 connections in A, because the
  server limits each connection, not the line.

### Two things this benchmark found and fixed

1. **Reconnect delay (scenario E).** A connection that was delivering data and then dropped used to wait a full 1 s backoff
   before reconnecting. On a flaky link that dominated the time (single connection: 22 s; now 9.7 s). A connection that was
   working now reconnects after about 125 ms; real backoff applies only when attempts keep failing.
2. **Halving on a merely flaky link (scenario E).** The "connections keep failing, halve the count" rule also counted connections
   that had delivered data before dropping, so a flaky link wrongly reduced parallelism (adaptive 1.5 s vs 1.1 s for plain 8).
   Only attempts that fail *without delivering anything* now count.

## Mirrors (tested separately)

With each server limited to 2 simultaneous transfers, downloading 24 MiB with 6 connections: **8.5 s from one server, 2.9 s with
two verified mirrors** (`mirrors_overcome_a_per_server_connection_limit`). Mirrors are only used when they have the same size and
ETag, and they never receive credentials meant for the primary site.

## HTTP/3 (tested separately, not benchmarked)

HTTP/3 is verified for **correctness and fallback**, not for speed:

* A real download from a CDN that advertises `Alt-Svc: h3=":443"` completed over **HTTP/3** (3 of 3 runs).
* When QUIC is silent (simulated by forcing HTTP/3 against a TCP-only server, like a network that blocks UDP), the download falls back
  to TCP, costing about 3.5 s once; the site is then skipped for HTTP/3 for 10 minutes.

No claim is made that HTTP/3 is faster: on a clean fast link QUIC in user space is often not faster than TCP, and its advantage
is on lossy paths, which this local benchmark does not model. Measuring that needs a real lossy network.

## Reproduce

```powershell
cd D:\I-Download\src-tauri
cargo run --release -p flowget-engine --example bench -- --runs 3 --out bench-results.md
cargo run --release -p flowget-engine --example bench -- --only G --runs 2     # one scenario
cargo run --release -p flowget-engine --example bench -- --describe            # list scenarios
```

The full run takes about 12 minutes. Do not run other heavy work meanwhile, it distorts the timings. Results vary a little between
machines and runs, mostly through the disk.
