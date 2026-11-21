# FlowGet user guide

FlowGet is a Windows download manager: it splits a file into parts, downloads them in parallel, resumes
after interruptions, and can take downloads over from your browser.

This guide describes what the app does today. Things that look finished in the interface but are not yet
real are listed under [Known limitations](#known-limitations) rather than documented as features.

## Contents
1. [Running FlowGet](#1-running-flowget)
2. [The window](#2-the-window)
3. [Adding downloads](#3-adding-downloads)
4. [Managing downloads](#4-managing-downloads)
5. [Queues and scheduling](#5-queues-and-scheduling)
6. [Settings](#6-settings)
7. [Turbo Mode](#7-turbo-mode)
8. [Browser extension](#8-browser-extension)
9. [Video and streams](#9-video-and-streams)
10. [FTP, SFTP and torrents](#10-ftp-sftp-and-torrents)
11. [Trial and license](#11-trial-and-license)
12. [Keyboard shortcuts](#12-keyboard-shortcuts)
13. [Known limitations](#known-limitations)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Running FlowGet

From the source folder:

```powershell
cd D:\I-Download
npm install
npm run tauri dev          # development window
npm run build              # builds the interface into dist\
cd src-tauri
cargo build --release --features tauri/custom-protocol    # builds flowget.exe with the interface embedded
```

Installer packages (MSI/NSIS) and code signing are described in `docs/code-signing-guide.md`; they have not
been exercised as part of this review. The app needs the Microsoft Edge WebView2 runtime (present on
current Windows 10 and 11).

Your downloads, queues and settings are stored in `%APPDATA%\com.flowget.app\flowget.db`.

## 2. The window

* **Title bar and menu** (Tasks, File, Downloads, View, Help), with a search box on the right that filters
  the list by name, URL or category.
* **Sidebar**: All Downloads, Unfinished, Finished, and categories. A disk-space gauge and a Disk Cleaner
  button sit at the bottom.
* **Toolbar**: an *Add Url* box and buttons for Resume, Stop, Stop All, Delete, Options, Queues, Schedule
  and Share.
* **Download list**: name, size, status bar, time left, last modification. The list is virtualized: only
  the rows on screen are drawn, so it stays responsive with thousands of entries (10,000 rows scroll and
  sort in well under a tenth of a second in testing; at around 50,000 rows search and sort become
  noticeably slow).
* **Footer**: *Select All*, the Speed Test button and the current download / upload figures.

## 3. Adding downloads

Pick whichever is handiest:

1. **Add Url box**: paste a link and press Enter (or click the download button). With the box empty the
   button opens the full dialog.
2. **Add Download dialog** (`Ctrl+N`, or *Tasks > Add URL...*): fields are
   *Download URL*, *File Name (optional)*, *Category*, *Save Folder* (with a Browse button), *Queue*,
   *Start Action*, *Connections (1-32)*, *Checksum (optional verification)*, *Speed Limit (MB/s)*,
   *Proxy (HTTP or SOCKS5)*, *User-Agent*, *Referer*, *Cookies* and *Mirrors (one URL per line)*.
   If you enter a checksum (SHA-256 or MD5), the file is verified when it finishes and the row says
   "checksum OK" or the download fails with a clear message.
3. **Drag and drop** a link onto the *Drop Link* widget.
4. **Clipboard prompt**: when a copied `http(s)` link looks like a file, FlowGet offers *Download this
   file?*.
5. **Browser extension** ([section 8](#8-browser-extension)): downloads from the browser open in the Add
   dialog with the cookies and referer filled in.
6. **Batch Download** (*Tasks > Batch Download...*): paste many links, or a pattern such as
   `https://example.com/img_[001-100].jpg` or `https://example.com/part_[a-z].zip`, then add them all.
7. **Site Grabber** (*Tasks > Site Grabber...*): crawl a page to a chosen depth and pick files by type.

Mirrors you list are checked against the main link (same size and validators) before use; a mirror that
does not match is ignored, and passwords and cookies are never sent to a mirror on another site.

## 4. Managing downloads

Select a row and use the toolbar, or right-click for: *Open*, *Open With*, *Open Folder*,
*Extract Archive*, *Scan with Defender*, *Move/Rename*, *Redownload*, *Resume Download*,
*Stop Download*, *Refresh Download Address*, *Grab URL from browser*, *Add to queue*,
*Delete from Queue*, *Share* and *Properties*.

* **Resume**: FlowGet resumes any download whose server supports byte ranges, including after closing the
  app, a crash, or a lost connection. It saves progress as it goes, and checks on resume that the file on
  the server has not changed. If it has, the download stops with an explanation and you can *Redownload*.
* **Servers that do not support resume**: the row shows a "Resume not supported" badge and uses one
  connection.
* **Network loss**: when the internet drops, downloads wait ("Waiting for network") and continue by
  themselves when it returns; a download you paused yourself stays paused.
* **Expired links**: right-click the download and choose *Refresh Download Address*, then paste the new
  link. FlowGet checks the file is the same and continues from where it stopped.
* **Speed limit**: per download in the Add dialog, or globally with the limit box at the top of the window.
* **Connections**: FlowGet starts with 4 connections and adds one at a time while the speed keeps
  improving, up to the number you chose. If a server refuses connections (HTTP 429 or 503) it reduces the
  count.
* **After a download finishes** (Settings): auto-extract archives, scan with Windows Defender, and open
  the folder.

## 5. Queues and scheduling

Open *Queues* (or *Schedule*) to create a queue with:

* **Max Concurrent** downloads.
* **Scheduler**: start time, optional stop time, and active days.
* **After the queue finishes**: do nothing, sleep, shut down, hibernate, exit FlowGet, or run a program.
* Conditions: download only on Wi-Fi, or only at night (between chosen hours).

Add a download to a queue from the Add dialog or the right-click menu.

## 6. Settings

*Options* opens: default download directory, launch on Windows startup, language (English or Deutsch),
theme (Dark, Light, System), default connections, **global speed limit**, **Turbo Mode**, a proxy
(`http://host:port` or `socks5://host:port`), and the post-download actions above. Under *Next-Generation
Features* are: **Battery-Saver Mode** (pauses active downloads when a laptop is unplugged and below 20%
battery), **Smart Naming** (cleans messy file names: query strings, `%20` and so on), Mobile Link Sharing,
Per-App Bandwidth View and Portable Mode. The last three are not finished; see the limitations below.

## 7. Turbo Mode

With two active networks (for example Wi-Fi plus a phone hotspot or USB tethering), Turbo Mode spreads a
download's connections across the adapters so their speeds add up. Enable it in *Options*; the dialog lists
the adapters FlowGet found. It needs an active trial or license.

How it works: each connection is bound to one adapter's local address. Results depend on both networks
being usable for the same server. **Turbo Mode was not benchmarked in this review** because the test
machine has a single adapter; see `docs/benchmarks.md`.

## 8. Browser extension

The extension (`extension\`) takes over browser downloads and passes the page's cookies and referer so
login-protected files work. Holding **Alt** while clicking a link lets the browser download it normally.
The right-click menu offers *Download all links on this page*, and a button appears over HTML5 videos.

Set-up (Chrome, Edge, Brave):

1. Open `chrome://extensions` (or `edge://extensions`), turn on *Developer mode*, choose
   *Load unpacked* and select the `extension` folder. Copy the extension's **ID** (32 letters).
2. Start FlowGet. The extension talks to it over a local port (`127.0.0.1:21588`), which is enough on its
   own while FlowGet is running.
3. Optional fallback through Chrome's native messaging: run
   `flowget-host.exe --register --extension-id <ID>` once (add `--firefox-id <add-on id>` for Firefox). The
   command refuses to run without an explicit ID: browsers do not accept wildcards.

Only browser extensions can reach the local port, not web pages, and every request is validated; see
`docs/security-review.md`.

## 9. Video and streams

* **HLS (`.m3u8`) and DASH (`.mpd`)** links are fetched and merged with `ffmpeg`; other video pages go
  through `yt-dlp`. **Both programs must be installed and on your PATH**; FlowGet does not bundle them.
* In the Add dialog you can pick a quality and convert to MP4, MP3 or M4A.
* Streams protected by DRM are refused with "This video is protected and cannot be downloaded."
* Media links must be plain `http://` or `https://`.

## 10. FTP, SFTP and torrents

* **FTP / FTPS** use the `curl.exe` that ships with Windows 10 and 11.
* **SFTP** needs Python with the `paramiko` package installed. Host keys are remembered on first connection
  and a later change is refused.
* **Torrents and magnet links** are handled by the built-in torrent engine.

## 11. Trial and license

A new installation has a 30-day trial. A license key is verified offline against a signature (*Help >
Activate License...*). Turbo Mode requires an active trial or license.

## 12. Keyboard shortcuts

| Keys | Action |
|---|---|
| `Ctrl+N` | Open the Add Download dialog |
| `Ctrl+F` | Focus the search box |
| `Ctrl+A` | Select all downloads |
| `Delete` / `Backspace` | Delete the selected downloads |
| `Space` | Pause / resume the selection |

## Known limitations

These parts of the interface are present but not finished. They are listed here so they do not surprise
you:

* **Speed Test** shows generated numbers. It does not measure your connection.
* **Mobile Link Sharing** shows a placeholder QR code and a fixed address; nothing is listening for a
  phone, and the local server accepts connections from this PC only.
* **Per-App Bandwidth**: FlowGet's own usage is real; the "other apps" figure is simulated.
* **Disk Cleaner** finds duplicates by identical URL (not by file contents), and lists old finished
  downloads and failed ones; it works on the download list.
* **Download Statistics** are computed from your download list.
* **Portable Mode** is saved as a setting but changes no behaviour yet; data always lives in `%APPDATA%\com.flowget.app`.
* Certificate errors on HTTPS downloads are rejected safely, but the row only shows "probing" and does not
  say why.
* On a first run, three of my early test launches of the release build exited after seven to ten seconds
  with no error. I could not reproduce it in 18 later launches. If FlowGet closes by itself on its very
  first start, launch it again and report it.

## 14. Troubleshooting

**My browser still downloads files itself.** Check the extension is enabled and FlowGet is running. If you
use the optional native messaging fallback, re-run `flowget-host.exe --register --extension-id <ID>` with
the correct ID.

**A download keeps saying "probing".** The server may be unreachable, or its HTTPS certificate is not
trusted (expired, self-signed, wrong name). FlowGet will not download from a site with an invalid
certificate.

**Downloads stop with "file changed".** The file on the server was replaced since you started. Use
*Redownload*.

**SFTP fails immediately.** Install Python and `pip install paramiko`.

**FlowGet will not start a second copy / the extension cannot connect.** Another program may be using port
21588. Close it and restart FlowGet.
