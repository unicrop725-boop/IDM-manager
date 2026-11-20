# Architecture (Phase 1 + Phase 2)

Phase 2 additions are described in [Phase 2 mechanisms](#phase-2-mechanisms) at the end of this file; the
text below is the Phase 1 design, which still holds (the fixed `Segment` table became a live
`SegmentTable`, and a segment's progress is now claimed by connections, see below).

```
┌──────────────┐  invoke(commands)   ┌─────────────────────────┐        ┌────────────────────┐
│ React UI     │ ──────────────────► │ src-tauri (app crate)   │ calls  │ flowget-engine     │
│ src/         │                     │  commands.rs            │ ─────► │  Engine            │
│              │ ◄────────────────── │  lib.rs  (event pump)   │        │  (no Tauri, no SQL)│
└──────────────┘  emit(events)       │  db.rs   (sqlx/SQLite)  │ ◄───── │  EngineEvent chan. │
                                     └─────────────────────────┘ events └────────────────────┘
```

* The UI only calls commands and listens to events.
* The app crate is glue: it forwards `EngineEvent`s to the webview and persists `Persist` events to SQLite.
* The engine is a library with no knowledge of Tauri or the database. It is fully testable on its own
  (`cargo test -p flowget-engine`), including crash/restart scenarios.

## Engine modules (`src-tauri/engine/src`)

| Module | Responsibility |
|---|---|
| `manager` | `Engine`: owns all downloads, state machine, run tasks, checkpoints, verification |
| `probe` | HEAD, fallback ranged GET; size, ranges, name, MIME, ETag, Last-Modified |
| `segments` | `split()`, `Segment`, consistency checks used for resume |
| `writer` | `OffsetFile`: pre-allocated file, `seek_write` / `write_at` at byte offsets |
| `worker` | Per-segment HTTP loop: stream, buffer, flush, retry with backoff |
| `limiter` | Token bucket (global + per download) |
| `http` | Client builder, redirects (10), cookies, headers, referer, UA; request sending with auth retry |
| `auth` | Basic and Digest (MD5 / SHA-256, `-sess`, `qop=auth`) |
| `filename` | Content-Disposition (RFC 6266 / 5987), URL names, Windows-safe sanitising, unique names |
| `checksum` | MD5 / SHA-1 / SHA-256 of the finished file |
| `progress` | Smoothed speed (EMA) and ETA |
| `policy` | Scheme check and DRM-site refusal |
| `error` | `EngineError` with plain-language `user_message()` |
| `model`, `events` | Serialisable records, UI snapshots, event types |

## Download lifecycle

```
add ─► Probing ─► Downloading ─► (Verifying) ─► Completed
          │            │  ▲
          │         pause│resume
          ▼            ▼  │
        Failed       Paused         cancel ─► Cancelled     restart ─► Probing (from byte 0)
```

1. **Probe**: `HEAD`; if it fails, `GET` with `Range: bytes=0-0`. If `HEAD` works but does not advertise
   `Accept-Ranges`, a 1-byte ranged `GET` tests it for real.
2. **Plan**: if the server supports ranges and the size is known, split into `min(connections, size / 1 MiB)`
   segments (sizes differ by at most one byte). Otherwise a single stream.
3. **Create the file** at full size (pre-allocation; fails early with "disk full").
4. **Workers**: one task per incomplete segment, each with its **own HTTP client** (own connection pool), so
   N segments are N parallel connections even over HTTP/2. Each worker requests
   `Range: bytes=<start+downloaded>-<end>` (plus `If-Range`), validates the `206` `Content-Range`, streams the
   body through the speed limiters into a 256 KiB buffer, and writes the buffer at its file offset
   (`spawn_blocking`, so the async runtime is never blocked by disk).
5. **Monitor loop** (every 250 ms): progress event; (every 1 s) durable checkpoint.
6. **Finish**: all segments complete and byte total equals the expected size, `fsync`, optional checksum,
   state `Completed`.

## Crash safety

* Segment counters advance only **after** a write has been handed to the OS.
* A checkpoint = snapshot counters → `fsync` file → emit `Persist(record)` with that snapshot.
  Therefore *persisted progress ≤ bytes on disk*, always. After a crash we may re-download up to ~1 s of data
  but never skip data.
* `restore()` turns anything that was active into `Paused`. Resume re-probes the server, verifies the file
  still exists with the full length, the segment table is consistent, and ETag / Last-Modified / size are
  unchanged, then continues each segment from its saved offset.
* If the partial file was deleted or damaged, the download quietly starts over.
* The server changing the file is reported as an error ("Use Restart") rather than producing a mixed file.

## Retry and network loss

Network errors, timeouts, 408/425/429/5xx and early connection closes are retried with exponential backoff
(1 s → 30 s, ±20 % jitter). A segment that made progress resets its failure counter. After
50 consecutive failures without progress the download is marked *Failed* (progress is kept; the user presses
Resume). 4xx errors (403, 404, ...) fail immediately with an explanation.

## Persistence

SQLite (WAL) in the app data directory:

* `downloads(id, state, created_at, updated_at, record JSON)` — `record` is the full `DownloadRecord`.
* `settings(key, value)` — global speed limit, default connections.

New `DownloadRecord` fields must use `#[serde(default)]` so older databases keep loading.

## Events (engine → UI)

| Tauri event | Payload | When |
|---|---|---|
| `download-progress` | `ProgressEvent` (downloaded, total, speedBps, etaSecs, per-segment progress, note) | every 250 ms per running download |
| `download-updated` | `DownloadInfo` | state / metadata change |
| `download-removed` | download id | after `remove` |

## Commands (UI → engine)

`add_download`, `pause`, `resume`, `cancel`, `restart`, `remove`, `get_downloads`, `set_speed_limit`,
`get_settings`, `set_default_connections`. Errors come back as plain-language strings.


## Phase 2 mechanisms

### Live segment table (`table.rs`)
The file is no longer a fixed list of ranges. `SegmentTable` holds `SegState`s: `start`, `end` (shrinks when
stolen from), `written` (bytes on disk), and live statistics (speed, last data time, "deliberately idle" flag).
Each segment has one lock protecting `{end, fetch_pos}`.

* A connection never reads bytes it has not **claimed** (`claim(n)` advances `fetch_pos` under the lock).
* **Stealing** (`steal(min_split)`) picks the running segment with the largest *remaining / speed*, then, under the same
  lock, sets `victim.end = split - 1` and creates `[split, old_end]` for a new connection, where
  `split = fetch_pos + remaining / 2`. Because claims and splits share the lock, the split point is always beyond
  the last claimed byte: no byte is fetched twice. `concurrent_claims_and_steals_cover_the_file_exactly_once`
  checks this under real thread contention.
* The victim notices its shrunk `end` on the next chunk, flushes, and closes its connection; the thief opens a
  new one on the second half.
* **Snapshots are atomic with respect to steals** (list lock held for the whole split). A snapshot that saw
  "victim shrunk but thief not listed" would look like a hole in the file and make a saved record unusable.
* Persisted segments are therefore dynamic: they must be contiguous once sorted by `start`, with unique ids
  (`segments::is_consistent`), instead of "index == position".

### Run loop (`manager.rs::run_phase`)
One loop with a 250 ms tick that:
1. updates per-segment speeds (moving average);
2. runs **stall detection** and **connection-count halving**;
3. fills worker slots (`fill_workers`): first segments with no connection (never started, parked, or closed
   after a stall), then **work stealing**;
4. emits progress and, at most once at a time, a durable checkpoint (separate task, so a slow `fsync` never
   blocks progress).

Whenever a worker ends the loop immediately refills the slot, so connections never idle while work remains.

### Stall detection
Per segment (monitor side): *zero-byte* rule (`stall_zero_after`, 3 s) and *relative-slow* rule (below
`stall_slow_ratio` x the average of running segments for `stall_slow_after`, 8 s, after a short warm-up). Segments
that are waiting on the speed limiter or in retry backoff are `exempt`. A stalled segment's connection token is
cancelled; its worker returns `Aborted`, flushing its buffer; the segment is restarted on a **fresh client**
(new TCP/TLS connection) from the first unwritten byte. Repeated stalls on one segment are damped with a growing delay.

### Connection count
`maybe_halve`: if `fail_threshold` (4) failures occurred within `fail_window` (20 s) while the internet is up,
`target = target / 2` (cooldown 20 s) and the slowest surplus connections are parked. At the end of a large
download `learn_domain` emits `EngineEvent::DomainBest`, stored in `domain_stats`; `merge_hint` decides what is
remembered (clearly faster, or equally fast with fewer connections, or forced by failures). New downloads with
no explicit connection count use it.

### Retry (`worker.rs`, `error.rs::RetryClass`)
| Class | Errors | Policy |
|---|---|---|
| Network | reset, timeout, DNS, TLS, early close | unlimited, backoff 1 s ... 60 s with jitter, wakes early when the network returns |
| Server | 408, 425, 429, 5xx | `max_server_retries` (10), honours `Retry-After` |
| Client | other 4xx | `max_client_retries` (3) |
| Fatal | 401/407, 416, 403/410 (-> link refresh), changed file, disk errors | no retry here |

### Network supervisor (`netwatch.rs`, `Engine::run_network_monitor`)
`Connectivity` = OS change events + reachability check (injectable for tests). On a trigger (OS event, or a worker
reporting repeated network errors) it checks; if offline it stops every active download with reason `NETWORK`
(progress saved, state `WaitingForNetwork`), polls every 2 s and on OS events, and on return resumes them.
`NetState::sleep_until_up` lets connections that were backing off retry immediately.

### Link refresh
A worker that receives 403/410 returns `LinkExpired`; `run_phase` stops all workers, checkpoints, and `execute`
re-probes the **original** address (up to 3 times with backoff). If the result has the same size / ETag /
Last-Modified and still supports ranges, download continues with the new final URL from the saved segments.
Otherwise the state is `LinkExpired` (progress kept) and `refresh_link(id, newUrl)` lets the user (or, later, the
browser extension) supply a fresh link for the same file.

### HTTP/3 and sources (`http.rs`, `worker.rs`)
* `probe` parses `Alt-Svc` (`parse_alt_svc_h3`): an `h3` entry on the same host, not withdrawn (`ma=0`), `clear` ignored.
* `HttpSession` keeps per-origin HTTP/3 state (`H3Plan`: Off / Auto / Force; untried / working / broken). `Auto` only uses
  QUIC for https URLs whose port equals the advertised one.
* Each connection attempt: pick a source, then a transport. HTTP/3 uses a 4 s header timeout. If it fails **before any
  response headers**, `h3_failed()` marks the origin broken for 10 minutes (for every connection of the download) and the
  same attempt is repeated over TCP at once, without counting a failure or backing off. A response over h3 marks it working.
* The latest response's protocol is tracked and shown in the UI (`DownloadInfo.protocol`).
* A **`SourceSet`** holds the primary link and the verified mirrors. `acquire()` picks the source with the fewest active
  connections (skipping benched ones), so connections spread evenly; three consecutive failures bench a source for 30 s;
  a success forgives it. Work stealing and stall restarts go through the same selection, so they also use mirrors.
* **Mirror verification** (`manager::mirror_matches`): ranges supported, same size, same ETag (both present); without ETags
  the same Last-Modified; otherwise refused. Mirrors are probed in parallel with a timeout and re-verified on every run.
  `HttpOptions::for_mirror` strips password, cookies and credential-like headers (names containing auth, cookie, token, key,
  secret, session) for mirrors on a different origin (scheme + host + port).
