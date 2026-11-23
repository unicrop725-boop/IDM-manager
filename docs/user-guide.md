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
  app, a crash, or a lost connection. With **Resume paused downloads on restart** (Options > Smart Features,
  on by default) the downloads that were running when FlowGet closed continue by themselves the next time it
  starts; downloads you paused yourself stay paused. It saves progress as it goes, and checks on resume that the file on
  the server has not changed. If it has, the download stops with an explanation and you can *Redownload*.
* **Wrong file**: when a server answers with a web page instead of the file (usually a sign-in page or an
  expired link), the download stops with "The server sent a web page instead of the file" and nothing is
  saved. Sign in in your browser and download it from there with the extension. If you really want the page,
  name the file with an `.html` ending.
* **Clear reasons**: while FlowGet contacts a server the row says "Connecting…", and if that fails it names
  the problem (site not found, certificate not trusted, connection refused, server not answering) with what
  to do. Hover over a failed row for the full text.
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
(`http://host:port` or `socks5://host:port`), and the post-download actions above. Under *Smart Features*
are: **Battery-Saver Mode** (pauses active downloads when a laptop is unplugged and below 20%
battery), **Smart Naming** (cleans messy file names: query strings, `%20` and so on),
the *Resume paused downloads on restart* switch and clipboard link detection. Passwords of downloads that
need a login are kept in the Windows Credential Manager, not in the database file.

### Bandwidth control

*Options > Bandwidth* builds on the global speed limit (Options > Connection); the stricter limit wins.

* **Limits by time of day**: add schedules with days, a start and end time (a window that ends before it starts
  runs past midnight), and an action: *Limit to* a speed, *Pause downloads*, or *No limit* (lifts the global limit
  in that window, for example at night).
* **Slow mode**: caps downloads at a gentle speed (default 1 MB/s) so browsing and calls stay smooth. Switch it
  on and off from the bar at the bottom of the window.
* **Metered and hotspot connections**: holds downloads on connections Windows marks as metered (phone hotspots,
  mobile data) and on Wi-Fi names you list as hotspots. They continue by themselves on a normal network. The
  bottom bar shows why downloads are held and has a *Download anyway* button.

The rules apply to normal file downloads. Videos downloaded through yt-dlp are not throttled or paused by them.

### Safety checks

* FlowGet warns about programs (`.exe`, `.msi`, scripts, `.scr`, ...) and about disguised names such as
  `invoice.pdf.exe`, extra spaces before the real ending, or hidden text-direction characters. The warning shows in
  the Add Download dialog, as a small shield next to the file in the list, and FlowGet asks before opening a file
  that has one.
* **VirusTotal** (Options > Safety, off until you add a free API key): when a download finishes, FlowGet looks up
  its SHA-256 fingerprint and shows how many antivirus engines flag it. Only the fingerprint is sent, never the
  file. The key is kept in the Windows Credential Manager. "Unknown" means VirusTotal has never seen that exact
  file, which is normal for new files. The free key allows 4 lookups a minute, so a long queue is checked slowly.

### Import and backup

*Tasks > Import & Backup...*

* **Import** from IDM (an `.ef2` export or a text list, with its cookies and referrers), Free Download Manager
  (a text list of links), JDownloader (`.crawljob` or a link list), any file that contains links, or the
  **download history of Chrome, Edge and Brave**. You see what was found, tick what you want, and choose whether
  to start right away.
* **Backup**: one file with settings, categories, queues and download history. It never contains passwords,
  cookies, request headers or your license key. **Restore** it on this or another PC; downloads that are already
  in the list are left alone and nothing is deleted.

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

In the extension's popup:

* **Settings > File types to capture** is a dropdown of predefined groups (archives, programs, video, audio,
  documents, other). Tick a whole group or single types, use *Recommended* / *Select all* / *Clear*, or add
  your own type. Only the chosen types are captured, both from link clicks and from browser downloads.
* The **storage card** shows the free and total space of your Disk Space drive (the one chosen in FlowGet's
  settings). When FlowGet is closed it shows the last known value and an *Open FlowGet* button.
* **Open FlowGet automatically** (on by default): grabbing a link while FlowGet is closed starts the app
  through its `flowget://` link, waits for it, and delivers the download. FlowGet registers that link for
  your Windows user each time it starts, so start it once. The browser may ask once whether `flowget://`
  links may be opened; allow it (and tick "always"). If the app cannot be started, the download goes back to
  the browser instead of being lost.

* **Reliability**: the extension checks every 30 seconds that FlowGet is answering and retries short outages.
  A download you grab while the app cannot be reached is kept (only in memory, for up to a day) and sent as
  soon as FlowGet answers; the toolbar badge shows how many are waiting, and the popup status says so.
  A desktop notification says "Download started in FlowGet" (switch it off with *Notify when a download
  starts*) or explains what is wrong. Downloads the browser started itself are handed back to the browser
  when FlowGet cannot be reached, so nothing is lost.

Only browser extensions can reach the local port, not web pages, and every request is validated; see
`docs/security-review.md`.

## 9. Video and streams

* **HLS (`.m3u8`) and DASH (`.mpd`)** links are fetched and merged with `ffmpeg`; other video pages go
  through `yt-dlp`. **FlowGet installs both by itself** the first time a video needs them (Options > Video
  Tools shows what is installed and lets you update or reinstall). They are saved in
  `%APPDATA%\com.flowget.app\tools`, checked against the checksum the publisher lists, and used before anything
  on your PATH. yt-dlp is refreshed about once a week in the background (switch that off in Video Tools).
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

* **Speed Test** really measures: latency and jitter, then download and upload through Cloudflare's speed
  servers (so it needs internet access to speed.cloudflare.com).
* **Bandwidth Usage** shows FlowGet's own current speed only; it does not see other programs.
* The import readers follow the file formats as documented and are tested with sample files; if a real export
  from IDM, FDM or JDownloader is not understood, use *Any file with links*, which finds every link in it.
* **Disk Cleaner** finds duplicates by identical URL (not by file contents), and lists old finished
  downloads and failed ones; it works on the download list.
* **Download Statistics** are computed from your download list.
* There is no portable mode; data always lives in `%APPDATA%\com.flowget.app`.
* A link with the user name and password inside it (`ftp://user:pass@host/...`) is kept as typed in the
  download list; only the separate password field is moved to the Credential Manager.
* On a first run, three of my early test launches of the release build exited after seven to ten seconds
  with no error. I could not reproduce it in 18 later launches. If FlowGet closes by itself on its very
  first start, launch it again and report it.

## 14. Troubleshooting

**My browser still downloads files itself.** Check the extension is enabled and FlowGet is running. If you
use the optional native messaging fallback, re-run `flowget-host.exe --register --extension-id <ID>` with
the correct ID.

**A download says "Connecting…" for a long time or fails right away.** The row (and its hover text) names the
reason: the site was not found, the server did not answer, the connection was refused, or its HTTPS certificate
is not trusted (expired, self-signed, wrong name). FlowGet will not download from a site with an invalid
certificate.

**"The server sent a web page instead of the file".** The site wants you signed in, or the link expired. Open it
in your browser, sign in, and download it from there so the extension can pass your session to FlowGet.

**Downloads stop with "file changed".** The file on the server was replaced since you started. Use
*Redownload*.

**SFTP fails immediately.** Install Python and `pip install paramiko`.

**FlowGet will not start a second copy / the extension cannot connect.** Another program may be using port
21588. Close it and restart FlowGet.
