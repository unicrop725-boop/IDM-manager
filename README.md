# FlowGet

A modern download manager for Windows (macOS and Linux later) that aims to match and beat
Internet Download Manager in features and speed, especially on slow and unstable connections.

> "FlowGet" is a **placeholder name**. The product name lives in `src-tauri/tauri.conf.json`
> (`productName`, `identifier`), `package.json`, `index.html`, and the window title in `src/App.tsx`.

**Status: Phase 2 of the plan** (speed and resilience on slow / unstable connections), on top of the
Phase 1 core engine. See [What is done / pending](#status).

## Tech stack

| Layer | Choice |
|---|---|
| Desktop shell | Tauri 2 |
| Download engine | Rust: tokio, reqwest (HTTP/1.1 + HTTP/2) |
| UI | React + TypeScript + Vite + Tailwind CSS 4 + lucide-react |
| Database | SQLite via sqlx |
| Later phases | yt-dlp / ffmpeg sidecars, browser extension (MV3 + Native Messaging), HTTP/3 (quinn/h3), Framer Motion |

## Folder structure

```
/src                 React UI (temporary test UI in Phase 1)
/src-tauri           Tauri app: commands, SQLite, event pump       (crate `flowget`)
/src-tauri/engine    Download engine, no UI and no Tauri code      (crate `flowget-engine`)
/extension           Browser extension          (Phase later)
/native-host         Native messaging host      (Phase later)
/docs                Architecture and testing notes
/scripts             Helper scripts / assets
```

`src-tauri/engine` is its own crate on purpose: the engine can be built and tested without the UI,
and the UI cannot reach into engine internals. See [docs/architecture.md](docs/architecture.md).

## Prerequisites (Windows)

1. **Node.js 20+** (developed with 22) and npm.
2. **Rust** (stable, MSVC toolchain): <https://rustup.rs>
3. **Visual Studio Build Tools / Visual Studio** with the **"Desktop development with C++"** workload.
4. **WebView2 runtime** (already present on Windows 10/11 with Edge).

### Build notes

- `src-tauri/.cargo/config.toml` sets `rustflags = ["--cfg", "reqwest_unstable"]`, which reqwest requires for HTTP/3. If
  you set the `RUSTFLAGS` environment variable yourself it *replaces* that setting and the build stops with a message
  about it; add `--cfg reqwest_unstable` to your `RUSTFLAGS` too. To build without HTTP/3, disable the engine's
  default feature: `cargo build --no-default-features` in `src-tauri/engine`.
- TLS: TCP connections use the Windows certificate store (Schannel); HTTP/3 uses rustls with the system roots.

### Disk space tip

A Tauri build output (`target/`) is several GB. If your project drive is small, put it elsewhere:

```powershell
setx CARGO_TARGET_DIR C:\flowget-target     # then open a new terminal
```

## Setup, run, build

```powershell
npm install

# Run the app in development mode (hot reload for the UI, rebuilds Rust on change)
npm run tauri dev

# Production build and installer (src-tauri/target or $CARGO_TARGET_DIR\release\bundle)
npm run tauri build
```

Frontend only type-check: `npm run build`.

## Tests

```powershell
cd src-tauri

# All engine unit + integration tests (use --release: they move real data through loopback)
cargo test -p flowget-engine --release

# The 1 GB acceptance test (pause at 40%, close app, reopen, resume, checksum must match)
cargo test -p flowget-engine --release -- --ignored --nocapture acceptance_1gb

# The 30-second internet-cut acceptance test (parks in "Waiting for network", auto-resumes, checksum matches)
cargo test -p flowget-engine --release -- --ignored --nocapture acceptance_network
```

To test by hand with the real app, run the local test server and download from it.
Full steps: [docs/testing.md](docs/testing.md).

```powershell
cd src-tauri
cargo run --release -p flowget-engine --example testserver -- --size-mb 1024 --rate-mb 16
```

## Engine features (Phase 1)

- **Probe before download**: `HEAD`, falling back to `GET Range: bytes=0-0`. Detects size,
  `Accept-Ranges`, file name (Content-Disposition, else URL), MIME type, ETag, Last-Modified.
- **Segmented parallel download** (default 8, user setting 1-32). Small files automatically use fewer
  connections. Each segment has its own connection pool, so N segments are N real TCP connections even over HTTP/2.
- **Direct offset writes**: the file is pre-allocated at full size and every segment writes straight
  into it at its byte offset. No `.part` files, no merge step.
- **No range support**: single-connection download, flagged `resumeSupported = false`
  (the UI shows "Resume not supported"). Unknown-length (chunked) downloads work too.
- **HTTP**: up to 10 redirects, cookie jar, custom headers, referer, user-agent, Basic and Digest authentication.
- **Pause / resume / cancel / restart / remove** for every download.
- **Live progress** every 250 ms: bytes, total, smoothed speed (moving average), ETA, per-segment progress.
- **Speed limiter**: token bucket, global and per download, adjustable while running.
- **Verification**: final size check, optional MD5 / SHA-1 / SHA-256 checksum.
- **Crash safety**: see below.
- **DRM**: links to DRM-protected services (Netflix, Prime Video, Hotstar, Spotify, ...) are refused with a
  polite message. We never bypass DRM.

## Faster and more resilient (Phase 2)

- **Dynamic segmentation (work stealing).** When a connection finishes its segment it takes the segment that
  will take longest to finish (most bytes left relative to its speed), splits the unfetched remainder in half and
  starts a new connection on the second half. No connection idles while work remains. Pieces smaller than
  256 KiB are never split off. On a download where one connection is slow this is ~3x faster in our tests
  (1.4 s vs 4.3 s).
- **Stall detection.** A connection that receives no data for 3 s, or runs below 10 % of the average segment
  speed for 8 s (both configurable), is closed and reopened on the remaining range. Waiting for the speed
  limiter or for a retry backoff is *not* a stall.
- **Adaptive connection count.** If connections keep failing while the internet is up (4 failures in 20 s),
  the count is halved (8 -> 4 -> 2 -> 1). The count that worked best per website is stored in SQLite
  (`domain_stats`) and reused when you do not pick a number yourself ("Auto").
- **Smart retry.** Exponential backoff with jitter: 1 s, 2 s, 4 s ... capped at 60 s. Network errors are retried
  **forever**; 408/425/429/5xx a limited number of times (10, honouring `Retry-After`); other 4xx only 3 times.
- **Waiting for network.** When the internet drops, every active download is saved and parked in *Waiting for
  network*; it resumes the moment the connection is back. Detection uses Windows network-change events
  (`NotifyIpInterfaceChange`, `NotifyUnicastIpAddressChange`) plus an active reachability check (a TCP connect to
  1.1.1.1 / 8.8.8.8 / 9.9.9.9, which works even where ICMP "ping" is blocked). Downloads you paused yourself
  stay paused.
- **Automatic link refresh.** A 403/410 in the middle of a download (an expired signed link) makes the engine
  re-open the original address, check it is the same file (size / ETag / Last-Modified), and carry on from the
  saved bytes. If that is impossible the download shows *Link expired* and keeps its progress; paste a fresh
  link for the same file ("Use new link") to continue.
- **HTTP/3 (QUIC) with automatic fallback.** The probe reads `Alt-Svc: h3=":443"`. When a server advertises HTTP/3
  on https, connections try QUIC first with a short 4 s handshake timeout; if it fails before any answer (UDP blocked,
  handshake trouble), the same attempt is repeated over TCP immediately and that website stays on TCP for 10
  minutes. The UI shows which protocol is in use. HTTP/2 is used automatically over TCP when the server offers it;
  each connection has its own connection pool, so N segments are N real connections.
  *Experimental:* reqwest's HTTP/3 needs the compiler flag `--cfg reqwest_unstable`, set in
  `src-tauri/.cargo/config.toml` (see "Build notes").
- **Mirrors.** Give extra links to the same file. Each one is verified first: it must support ranges and report the same
  size and the same ETag (or, without ETags, the same Last-Modified); otherwise it is not used and the reason is shown.
  Verified mirrors serve different segments at the same time (each new connection goes to the least busy, healthiest
  source); a mirror that keeps failing is benched while the others carry on. A mirror on a *different origin* never
  receives your password, cookies, or credential-like headers.
- **Fast reconnect.** A connection that was delivering data when it dropped reconnects after ~125 ms instead of waiting a
  full backoff step; normal backoff applies only when attempts keep failing.
- **Large-file write path:** unchanged from Phase 1, see "Pending".

### Crash, restart and network-loss safety

- Progress is checkpointed about once a second: the engine snapshots the per-segment counters, `fsync`s the
  file, *then* hands the snapshot to SQLite. The database never claims bytes that are not on disk.
- On start the app loads the saved downloads; anything that was running comes back as **Paused** with its progress.
- Closing the window pauses every download and waits for the final checkpoint before exiting.
- Dropped connections are retried with exponential backoff (1 s up to 30 s, jittered) and continue from the
  first byte not yet written. A connection that delivers nothing for 30 s is treated as dead.
- `If-Range` is sent with every resumed request, and the file's ETag / Last-Modified / size are re-checked
  on resume, so a file that changed on the server is detected instead of silently corrupted.

## Status

**Done in Phase 1:** everything in "Engine features", the Tauri commands
(`add_download`, `pause`, `resume`, `cancel`, `restart`, `remove`, `get_downloads`, `set_speed_limit`,
plus `get_settings` and `set_default_connections`), a minimal test UI, and the Rust unit/integration tests.

**Done in Phase 2:** work stealing, stall detection, connection halving and per-domain memory, smart retry,
the network supervisor (*Waiting for network*), automatic link refresh (+ `refresh_link` command and UI),
and tests for all of it, including the 30-second internet-cut acceptance test.

**Also done in Phase 2:** HTTP/3 with `Alt-Svc` detection and fallback, mirrors (verified by size and ETag), fast
reconnect, and a benchmark (`docs/benchmarks.md`).

**Pending / known limits:**

- Passwords for authenticated downloads are kept in the Windows Credential Manager (target `FlowGet/download/<id>`), not
  in the SQLite file; an older plain-text password is moved there the first time the app starts. A password typed
  inside the URL itself (`ftp://user:pass@host/...`) is still stored with the link.
- Preallocation uses `SetEndOfFile`; on NTFS the first write far into a big file makes Windows zero-fill the gap.
  If this shows up in benchmarks, use sparse files / `SetFileValidData`.
- HTTP/3 only follows an `Alt-Svc` that points at the same host and port (the common `h3=":443"`); other alternative
  authorities are ignored. It is built on reqwest's unstable HTTP/3 support.
- Proxies, FTP, queues/scheduler, categories, clipboard monitor, yt-dlp/ffmpeg media downloads, browser extension and
  native host, installer polish: later phases.
- Dynamic re-segmentation (a fast segment taking over the tail of a slow one) is not implemented yet.
- Downloads that were running when the app closed (or crashed) resume at startup unless "Resume paused downloads on restart" is switched off; ones the user paused stay paused.
