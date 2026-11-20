# Testing (Phase 1)

## 1. Automated tests

```powershell
cd D:\I-Download\src-tauri
cargo test -p flowget-engine --release
```

| Area | Where | What it proves |
|---|---|---|
| Segment splitting | `engine/src/segments.rs` | contiguous, no gaps/overlaps, sizes differ by ≤ 1 byte, minimum size, 1-32 connections, > 4 GB offsets, tiny/empty files |
| Offset writing | `engine/src/writer.rs` | writes land at the right offset, out-of-order and concurrent writers reassemble the original, preallocation, reopen for resume |
| Resume logic | `engine/src/segments.rs` + `engine/tests/engine_tests.rs` | remaining ranges, consistency checks; pause→resume; restart from a saved JSON record; **abrupt crash** then resume; changed-file detection; no re-download of finished bytes |
| Speed limiter | `engine/src/limiter.rs`, `engine_tests.rs` | token bucket timing (virtual time), live changes, global and per-download limits |
| HTTP | `engine_tests.rs` | HEAD fallback, no-range servers, chunked/unknown length, redirects (+loop), headers, referer, UA, cookies, Basic and Digest auth, dropped connections |
| Auth / names / checksum | module tests | RFC 2617 and RFC 7616 Digest vectors, Content-Disposition (incl. path traversal), MD5/SHA vectors |
| Policy | `engine/src/policy.rs` | DRM sites refused, other schemes refused |

## 2. Acceptance test (automated)

> Download a 1 GB test file with 8 connections, pause at 40%, close the app, reopen, resume,
> and the final file checksum must match the original.

```powershell
cd D:\I-Download\src-tauri
cargo test -p flowget-engine --release -- --ignored --nocapture acceptance
```

It starts the local test server (1 GiB generated on the fly, 8 connections at 16 MiB/s each), pauses at ≥ 40 %,
shuts the first engine down exactly like closing the window, builds a **second engine** from only the saved
record and the file on disk, resumes, and compares SHA-256 with the expected value. It needs about 1 GB free
in your temp folder (`%TEMP%`).

## 3. Acceptance test (by hand, with the real app)

Terminal 1: the local test server (nothing is stored on disk; the file is generated on demand):

```powershell
cd D:\I-Download\src-tauri
cargo run --release -p flowget-engine --example testserver -- --size-mb 1024 --rate-mb 16
```

It prints the URL (`http://127.0.0.1:8099/file.bin`) and the expected SHA-256 after a few seconds.

Terminal 2: the app:

```powershell
cd D:\I-Download
npm run tauri dev
```

1. Paste `http://127.0.0.1:8099/file.bin`, connections = 8, press **Add**.
   You should see 8 segment bars filling in parallel, speed (~128 MB/s) and an ETA.
2. When the bar passes **40 %**, press **Pause**. State becomes *Paused*; the bytes stay fixed.
3. **Close the app window.** (It pauses everything and saves before exiting.)
4. Start the app again (`npm run tauri dev`). The download is listed as *Paused* at the same position.
5. Press **Resume**. It continues from the saved offsets and completes.
6. Compare the checksum with the one printed by the server:

   ```powershell
   Get-FileHash "$env:USERPROFILE\Downloads\test-1024mb.bin" -Algorithm SHA256
   ```

Extra manual checks:

* **Crash test:** while downloading, kill the app (`taskkill /F /IM flowget.exe`), restart, press Resume.
  The checksum must still match.
* **Internet loss:** stop the test server (Ctrl+C) mid-download. The row shows "Connection problem,
  reconnecting..." Start the server again; the download continues by itself.
* **Resume not supported:** restart the server with `--no-ranges`. The row shows the *Resume not supported*
  badge and a single connection.
* **Speed limit:** type a value in the row's *Limit* box or the *Global limit* box (MB/s).
* **DRM:** paste `https://www.netflix.com/title/1`. A polite refusal appears.
* **Checksum:** add the server URL with the printed `sha256:...`; the row shows "checksum OK". With a wrong value
  the download fails with a clear message.


## Phase 2 tests

Run all (debug is fine; use `--release` for the 1 GB test):

```powershell
cd D:\I-Download\src-tauri
cargo test -p flowget-engine
```

| What | Test |
|---|---|
| Table invariants | `table.rs`: steal splits remainder in half, 256 KiB minimum, picks slowest / most bytes left, **concurrent claims + steals cover the file exactly once** |
| Work stealing speedup | `work_stealing_rescues_a_slow_segment` (with vs without stealing: 1.4 s vs 4.3 s), `many_connections_with_uneven_speeds_still_produce_the_exact_file` |
| Stall detection | `a_connection_with_no_data_is_closed_and_reopened`, `a_connection_far_below_the_average_speed_is_replaced`, `a_download_throttled_by_the_speed_limiter_is_not_mistaken_for_a_stall` |
| Connection count | `connection_count_is_halved_when_the_server_keeps_refusing_connections`, `a_large_clean_download_remembers_its_connection_count`, `remembered_count_is_used_unless_the_request_chooses`, `merge_hint` unit tests |
| Retry | backoff schedule + cap unit tests, `client_errors_are_retried_only_a_few_times`, `server_errors_honour_retry_after_and_stop_at_the_limit`, `network_errors_are_retried_without_a_limit` |
| Network supervisor | `short_network_cut_with_os_events_parks_and_auto_resumes`, `network_cut_is_detected_and_ended_by_polling_alone`, `a_download_the_user_paused_is_not_resumed_when_the_network_returns`, real Windows API registration test |
| Link refresh | `an_expired_signed_link_is_refreshed_automatically`, `when_the_page_is_gone_the_download_asks_for_a_fresh_link` |

### Acceptance: the download auto-recovers from a 30-second internet cut

```powershell
cargo test -p flowget-engine --release -- --ignored --nocapture acceptance_network
```

The local server drops every connection for 30 s while the engine's connectivity probe reports "offline".
Expected: the download parks in *Waiting for network* within a second, makes no progress and does not fail for
30 s, resumes within a second of the connection returning, and the final SHA-256 matches.

### By hand, with the real app
1. Start the test server (see above) and a download of the 1 GB file.
2. Turn Wi-Fi off (or unplug the cable). The row turns orange, *Waiting for network*, within a few seconds.
3. Wait 30 s, turn Wi-Fi on. The download resumes by itself (state *Downloading*); on completion compare
   `Get-FileHash` with the server's SHA-256.

(The test server runs on localhost, so for this manual test only the OS network events and the reachability probe
are exercised, not the data path. The automated test covers the data path with a simulated outage.)


## Mirrors, HTTP/3 and benchmarks

| What | Test |
|---|---|
| Alt-Svc parsing, HTTP/3 state machine, per-site QUIC memory | unit tests in `probe.rs`, `http.rs` |
| Mirror verification rules, source spreading, benching | unit tests in `manager.rs` (`mirror_matches`), `worker.rs` (`SourceSet`) |
| Mirrors serve different segments at once; impostors (other ETag / size) are refused and never used | `verified_mirrors_serve_different_segments_at_the_same_time` |
| Mirrors beat a per-server connection limit (8.5 s from one server vs 2.9 s with 2 mirrors) | `mirrors_overcome_a_per_server_connection_limit` |
| A mirror dying mid-download is covered by the others | `a_dying_mirror_does_not_stop_the_download` |
| Passwords / cookies / key headers never reach a mirror on another origin | `credentials_are_not_sent_to_a_mirror_on_another_origin` |
| QUIC silent or blocked: falls back to TCP in ~3.5 s, once, with no error | `when_quic_cannot_be_used_the_download_falls_back_to_tcp_quickly` |
| Alt-Svc seen over plain http is ignored | `an_http3_advertisement_on_plain_http_is_ignored` |
| **Real HTTP/3 against a CDN** (needs internet + UDP/443) | `cargo test -p flowget-engine -- --ignored --nocapture real_http3` |
| Diagnostic: what a server advertises and what happens speaking h3 to it | `cargo test -p flowget-engine -- --ignored --nocapture diagnose_real_http3` |

### Benchmarks

```powershell
cd D:\I-Download\src-tauri
cargo run --release -p flowget-engine --example bench -- --runs 3 --out bench-results.md
# one scenario only:  ... -- --only B
```

Results and how to read them: [benchmarks.md](benchmarks.md). Takes about 10 minutes; do not run other heavy work
meanwhile, it would distort the timings.
