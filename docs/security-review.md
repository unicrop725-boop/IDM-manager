# Security review (Phase 9)

Scope: native messaging, remote code execution, file-path safety, HTTPS certificate checks, and the
local loopback server. Method: reading every place that spawns a process, parses a URL or file name, or
accepts input from outside the app; reproducing each suspected bug against the old code before
fixing it where that was practical; adding regression tests; observing certificate handling against
deliberately broken servers.

"Reproduced" below means the old code was run and the bad behaviour was seen. "By inspection" means the
bug is clear from the code but was not exploited end to end.

## Fixed in this phase

| # | Severity | Problem | Evidence | Fix |
|---|---|---|---|---|
| 1 | Critical | **SFTP code injection** (`protocols.rs`). The URL's host, user, password and path were pasted into a Python script run with `python -c`. A single quote is *not* percent-encoded in URL userinfo or path, so `sftp://u'...@host/` broke out of the string literal and ran arbitrary Python. | Reproduced: old template with a hostile user name ran `os.system(...)`; a WHATWG URL parser keeps `'` in user, password and path. | The script is now a constant. Host, port, user, path and output path are passed as `argv`; the password in an environment variable (not visible in the process list). Tests assert the script contains no placeholders and that hostile URLs stay data. |
| 2 | High | **PowerShell injection on extraction** (`post_download.rs`). If `tar.exe` failed on a `.zip`, the path (which contains the server-chosen file name) was spliced into `Expand-Archive -LiteralPath '...'`. Auto-extract runs this with no click. | Reproduced: a file named `a'; ni marker #.zip` created `marker`. (A name ending `'.zip` leaves a parse error and does nothing; the `#` form avoids that.) | Constant command; paths passed in environment variables. Regression test with the `#` payload. |
| 3 | High | **`cmd /C start` path splitting** (`open_file`). `cmd` interprets `&`, `^`, `%` in the path; `sanitize` allows `&`, so a file called `x&calc.exe` would start a second command. | By inspection (not exploited end to end). | `explorer.exe <path>`: the path is a single argument and no shell is involved. |
| 4 | Medium | **yt-dlp option injection / ffmpeg input abuse** (`media_stream.rs`). The user URL was a bare yt-dlp argument (`--exec=...` is parsed as an option); ffmpeg got any URL, including `file:` and `concat:`. | By inspection. | URLs must parse as `http(s)` with a host and must not start with `-`; yt-dlp gets `--` before the URL; ffmpeg DASH input uses `-protocol_whitelist http,https,tcp,tls,crypto`. |
| 5 | Medium | **Loopback server open to web pages** (`ipc_server.rs`, `127.0.0.1:21588`). `Access-Control-Allow-Origin: *`, pre-flights allowed, no `Origin`/`Host` check, any content type, a single 64 KB read. Any web page (or DNS-rebinding site) could make FlowGet open its Add dialog pre-filled with an attacker URL, cookies and referer. | Read from code; the Add dialog does not auto-start, which limited the impact. | No CORS headers, `OPTIONS` refused; `Origin` (if present) must be `chrome-extension://` or `moz-extension://`; `Host` must be the server's own loopback address; `POST` needs `Content-Type: application/json`; whole body read with a 1 MiB cap and 5 s timeouts; payload validated (URL scheme allow-list, field types and sizes); a sender-supplied `saveDir` is discarded. Tests include a real-socket round trip with a split body and a web-page origin. |
| 6 | Medium | **Native host unvalidated, wrong manifest** (`flowget-host.rs`). No message validation; error text pasted into JSON; `allowed_origins: ["chrome-extension://*/"]` (Chromium does not accept wildcards there, so the restriction did not work as written); Firefox needs `allowed_extensions`, not `allowed_origins`. | By inspection. | Messages are parsed and validated before forwarding (shared `payload_check.rs`); responses are built with a JSON serializer; timeouts and a response cap; `--register` requires `--extension-id` (32 characters a-p) and/or `--firefox-id`, refuses to run without one, and writes a separate Firefox manifest. |
| 7 | Medium | **SFTP accepted any host key** (`AutoAddPolicy`). | By inspection. | Trust on first use: host keys are pinned in `%LOCALAPPDATA%\FlowGet\sftp_known_hosts`; a changed key for a known host fails the connection. |
| 8 | Low | **FTP via curl followed redirects to any protocol.** | By inspection. | `--proto =ftp,ftps --proto-redir =ftp,ftps`. |

## Checked and found sound

* **Path traversal** (`filename.rs::sanitize`): keeps only what follows the last `/` or `\`, replaces
  illegal characters, strips trailing dots and spaces (so `..` becomes empty), prefixes reserved device
  names (`CON`, `NUL`, `COM1`...), limits length. Covered by unit tests (`content_disposition_path_traversal_is_stripped`,
  `sanitize_illegal_and_reserved`).
* **HTTPS certificate validation**: there is no `danger_accept_invalid_certs` anywhere. Observed with the
  engine against badssl.com: a valid certificate downloaded (11,673 bytes); expired, self-signed,
  wrong-host and untrusted-root certificates downloaded **0 bytes** and wrote nothing to disk.
* **Other process spawns** (`reg.exe`, `tar.exe`, `MpCmdRun.exe`, folder picker): arguments are passed
  as separate argv elements; the folder-picker script escapes single quotes.

## Not fixed / residual risk

1. **Another installed browser extension can still use the loopback port.** The `Origin` check keeps web
   pages out, not other extensions. A per-install secret shared with the official extension (generated
   at first run, stored by the app, handed to the extension at pairing) would close it.
2. **Tauri CSP is `null`** (`tauri.conf.json`). The UI loads no remote content, so the practical risk is
   low, but a restrictive CSP is cheap defence in depth. It needs testing against the real UI before
   switching on; it was not changed here.
3. **Certificate failures are invisible to the user.** A rejected certificate leaves the download in an
   endless "probing" state with no message. It is safe but confusing.
4. **SFTP depends on a system Python with `paramiko`**, and FTP on `curl.exe`. Neither is bundled, so SFTP
   fails on a machine without them (the error says so). A native Rust SFTP client would remove both the
   dependency and the process spawn.
5. **Not reviewed:** redirect handling (e.g. https to http), Mark-of-the-Web on downloaded files,
   archive extraction path escapes (relies on `tar.exe` / `Expand-Archive` behaviour), the license server
   in `server/`. The license and trial checks keep their state in places the user controls
   (registry, a file, the local database); treat them as a nudge, not a security boundary.

## Re-running the checks

```powershell
cd D:\I-Download\src-tauri
cargo test --workspace --release      # includes the security regression tests
```

The tests that pin the fixes: `protocols::tests::*`, `post_download::tests::*`, `media_stream::tests::*`,
`ipc_server::tests::*`, `payload_check::tests::*`, and the native host's own unit tests.
