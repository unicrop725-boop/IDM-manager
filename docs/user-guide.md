# FlowGet User Guide

Welcome to **FlowGet**, the high-performance, next-generation download manager for Windows. Built with a lightning-fast Rust core and a modern dark desktop interface, FlowGet delivers maximum throughput, intelligent resilience on unstable networks, and seamless browser integration.

---

## Table of Contents
1. [Overview & Key Features](#1-overview--key-features)
2. [Installation & Setup](#2-installation--setup)
3. [User Interface Tour](#3-user-interface-tour)
4. [Adding & Managing Downloads](#4-adding--managing-downloads)
5. [Browser Integration (Chrome, Edge, Brave, Firefox)](#5-browser-integration)
6. [Turbo Mode: Multi-Adapter Bonding](#6-turbo-mode-multi-adapter-bonding)
7. [Streaming Media Ripper & Sidecar Tools](#7-streaming-media-ripper--sidecar-tools)
8. [Protocols: HTTP, FTP, SFTP & Torrents](#8-protocols-http-ftp-sftp--torrents)
9. [Batch Downloader & Site Grabber](#9-batch-downloader--site-grabber)
10. [Exclusive FlowGet Tools](#10-exclusive-flowget-tools)
    - [Speed Test & History](#speed-test--history)
    - [Smart Disk Cleaner](#smart-disk-cleaner)
    - [Bandwidth Monitor](#bandwidth-monitor)
    - [Mobile QR Link Sharing](#mobile-qr-link-sharing)
    - [Download Statistics](#download-statistics)
11. [Queues & Scheduling](#11-queues--scheduling)
12. [Licensing & Activation](#12-licensing--activation)
13. [Keyboard Shortcuts](#13-keyboard-shortcuts)
14. [Troubleshooting & FAQ](#14-troubleshooting--faq)

---

## 1. Overview & Key Features

- **Adaptive Dynamic Segmentation:** Files are partitioned into concurrent byte segments. If one connection slows down or freezes, active connections automatically steal remaining bytes from the slow connection (*Work Stealing*).
- **Turbo Mode Multi-Adapter Bonding:** Download simultaneously using both your Wi-Fi and Mobile Hotspot / Ethernet to combine speeds.
- **Resilient Network Supervisor:** Instantly pauses downloads when connectivity drops and auto-resumes within 125 ms of connection return without corrupting data.
- **Streaming Media Ripper:** Captures non-DRM HLS (`.m3u8`) and DASH (`.mpd`) video streams, and downloads YouTube/social media videos via bundled `yt-dlp` with automatic `ffmpeg` audio/video merging.
- **Universal Protocol Support:** Native HTTP/HTTPS, FTP/FTPS, SFTP, and BitTorrent/Magnet links.
- **Native Extension Integration:** Intercepts browser downloads, passes authentication cookies and referer headers, and provides a floating "Download Video" button over video players.
- **Modern Hardware-Accelerated UI:** Sleek dark interface, Framer Motion animations, virtualized table capable of rendering 10,000+ items at 60 FPS, and minimal resource footprint (<80 MB RAM, <4% CPU).

---

## 2. Installation & Setup

### Standard Installation (MSI / NSIS)
1. Download the latest installer `FlowGet_Setup_x64.exe` or `FlowGet_Setup_x64.msi`.
2. Run the installer and select your installation options:
   - Create Desktop Shortcut
   - Launch FlowGet on Windows Startup
   - Register as Default Windows Download Manager
   - Register Browser Native Messaging Host
3. Click **Install**. FlowGet is installed to `%LOCALAPPDATA%\Programs\FlowGet`.

### Portable Mode
FlowGet can be run directly from a USB flash drive or portable storage without administrative privileges:
1. Extract `FlowGet_Portable.zip` onto your USB drive.
2. Ensure `portable.ini` exists in the same folder as `FlowGet.exe`.
3. When launched, FlowGet will store all database files, settings, and temporary `.flowget.part` files within the local directory rather than the Windows AppData directory.

---

## 3. User Interface Tour

```
┌────────────────────────────────────────────────────────────────────────┐
│ [Icon] FlowGet 1.0                              [ - ] [ □ ] [ ✕ ]      │
├────────────────────────────────────────────────────────────────────────┤
│ Tasks  File  Downloads  View  Help         [ 🔍 Search in the List... ]│
├───────────────┬────────────────────────────────────────────────────────┤
│ SIDEBAR       │ TOOLBAR: [ 🔗 Add URL pill ] [Resume][Stop][Del][Opts] │
│ • All (142)   ├────────────────────────────────────────────────────────┤
│   - Musics    │ DOWNLOAD TABLE (Virtualized 10,000+ items)             │
│   - Compressed│ [x] File Name   | Size   | Status     | ETA  | Modified│
│   - Videos    │ ------------------------------------------------------ │
│   - Programs  │ [ ] ubuntu.iso  | 4.2 GB | 85% [====] | 32s  | Today   │
│   - Documents │ [ ] setup.exe   | 150 MB | Complete   | --   | 10m ago │
│ • Unfinished  ├────────────────────────────────────────────────────────┤
│ • Finished    │ FOOTER BAR:                                            │
│ [Disk Space]  │ [x] Select All  | ⚡ Speed Test | ↓ 14.8 MB/s | ↑ 1.2 MB/s│
└───────────────┴────────────────────────────────────────────────────────┘
```

1. **Title Bar:** Custom frameless title bar with minimize, maximize, and close controls.
2. **Menu Bar:** Quick access to Tasks, File operations, View toggles, and Help documentation. The right side features a real-time table search filter.
3. **Left Sidebar:** Categories (All, Music, Compressed, Videos, Programs, Documents, Images, Torrents) with unread/status badges, plus the interactive **Disk Space Widget** and **Disk Cleaner** launcher.
4. **Toolbar:** Action buttons for adding URLs, starting, pausing, stopping all, deleting, configuring options, and queue management.
5. **Download Table:** High-performance virtualized table displaying file icons, name, category, size, status bar, remaining time, and modification timestamps.
6. **Footer Bar:** Bulk selection, interactive speed test gauge, and aggregate live download/upload throughput indicators.

---

## 4. Adding & Managing Downloads

### Method 1: Toolbar Add URL Pill
1. Paste or type any URL directly into the "Add URL" input pill in the toolbar.
2. Press **Enter** or click the circular gradient download button.

### Method 2: Detailed Add Download Dialog (`Ctrl+N`)
Click the **+** button or press `Ctrl+N` to open the full configuration dialog:
- **Download URL:** The target URL or Magnet link.
- **File Name:** Pre-populated from URL or Content-Disposition; editable with auto-clean smart naming.
- **Save Directory:** Select destination folder (default: `C:\Downloads`).
- **Category:** Auto-detected by extension or manually set.
- **Connections:** Choose 1 to 32 parallel connections.
- **Start Option:** Start Immediately or Add to Queue (Start Later).
- **Checksum Verification (Optional):** Enter expected SHA-256 or MD5 hash; FlowGet will verify the file upon completion.

### Method 3: Drag & Drop
Drag any URL, text link, or `.torrent` file from your browser or file explorer and drop it onto the FlowGet window.

### Method 4: Clipboard Monitor
When enabled in Settings, copying any valid URL (`http://`, `https://`, `magnet:`) displays a lightweight desktop toast: *"Download this file with FlowGet?"*. Click **Download** to capture immediately.

---

## 5. Browser Integration

FlowGet includes a Manifest V3 browser extension for **Google Chrome**, **Microsoft Edge**, **Brave**, and **Mozilla Firefox**.

### How It Works
- Intercepts browser download events (`chrome.downloads.onDeterminingFilename`).
- Forwards login session cookies, authorization tokens, referer URLs, and custom user-agent headers to FlowGet via the native messaging host.
- Downloads protected behind authentication portals (e.g. Google Drive, MEGA, university portals) download without login prompts.

### Features
1. **Hold `Alt` to Bypass:** Holding the `Alt` key while clicking a download link lets the native browser download the file instead of FlowGet.
2. **Video Sniffer:** When viewing video players (HTML5, YouTube, Vimeo, streaming sites), a floating **Download this Video** badge appears in the top-right corner with a quality selector (1080p, 720p, 480p, Audio Only).
3. **Download All Links:** Right-click anywhere on a web page and select *"Download all links with FlowGet"* to open a batch selector with file-type filters.

---

## 6. Turbo Mode: Multi-Adapter Bonding

FlowGet can aggregate multiple physical network adapters into a unified high-speed pipeline.

### Setup Instructions
1. Connect your PC to your primary network (e.g., home Wi-Fi or Ethernet).
2. Connect a secondary network (e.g., connect your Android/iOS smartphone via USB and enable **USB Tethering** or Wi-Fi hotspot).
3. In FlowGet, open **Options / Settings** -> **Network**.
4. Enable **Turbo Mode (Multi-Adapter Bonding)**.
5. FlowGet will detect both network interfaces (e.g., `192.168.1.100` and `192.168.42.15`).
6. Segment worker connections are round-robin bonded across the selected adapters, allowing a 100 Mbps Wi-Fi and a 50 Mbps 4G link to download at up to **150 Mbps**.

---

## 7. Streaming Media Ripper & Sidecar Tools

FlowGet comes pre-configured with support for streaming protocols and sidecar utilities (`yt-dlp` and `ffmpeg`):

### HLS (`.m3u8`) & DASH (`.mpd`)
- Automatically detects media playlist manifests.
- Fetches all segment chunks in parallel using FlowGet's high-speed engine.
- Merges the streams with `ffmpeg` without re-encoding to retain 100% original quality.

### Video Quality & Audio Extraction
In the Add Download dialog:
- Choose resolution: `Original`, `1080p`, `720p`, `480p`, or `Audio Only`.
- Convert to output format: `Original (No re-encoding)`, `MP4`, `MP3`, or `M4A`.

> [!IMPORTANT]
> FlowGet respects copyright protections and DRM mechanisms. Videos protected with Widevine, FairPlay, or PlayReady DRM cannot be downloaded and will display: *"This video is protected and cannot be downloaded."*

---

## 8. Protocols: HTTP, FTP, SFTP & Torrents

- **HTTP / HTTPS:** HTTP/1.1, HTTP/2 multiplexing, and HTTP/3 (QUIC over UDP) with fallback.
- **FTP / FTPS:** Implicit and explicit TLS file transfers with segmented byte ranges.
- **SFTP:** Secure file transfer over SSH keys or password authentication.
- **BitTorrent & Magnet Links:** Native peer discovery, DHT, tracker communication, and sequential piece downloading for media previewing.

---

## 9. Batch Downloader & Site Grabber

### Batch Downloader
1. Click **Tasks** -> **Batch Download**.
2. Paste a list of URLs or use wildcard pattern syntax:
   `https://cdn.example.com/assets/image_[001-100].jpg`
   `https://files.example.com/data_archive_[a-z].zip`
3. Click **Generate Items** -> **Add All to Queue**.

### IDM-Style Site Grabber
1. Click **Tasks** -> **Site Grabber**.
2. Enter the target website URL.
3. Configure crawl depth (1 to 4 levels).
4. Select target file types (e.g. Images, Documents, Videos, Audio).
5. Review the discovered file hierarchy and start batch capture.

---

## 10. Exclusive FlowGet Tools

### Speed Test & History
Click the speedometer icon in the footer to run a real-time internet speed test:
- Tests Ping (latency), Jitter, Download speed, and Upload speed.
- Visual animated speedometer gauge.
- Saves historical test runs to track network performance over time.

### Smart Disk Cleaner
Launch from the sidebar Disk Space widget:
- Scans chosen download folders for:
  - Exact duplicate files (verified by SHA-256 hash).
  - Completed downloads older than X days.
  - Leftover orphaned `.flowget.part` temporary files.
- One-click safe cleanup to free disk space.

### Bandwidth Monitor
Displays per-application bandwidth utilization:
- Shows how much bandwidth FlowGet is consuming versus other running Windows apps and browsers.
- Real-time live updating graph.

### Mobile QR Link Sharing
Want to send a link from your phone to your PC?
1. Click the **Mobile Share** icon or menu item.
2. Scan the displayed QR code with your smartphone camera.
3. Your phone opens a local Wi-Fi web page hosted by FlowGet.
4. Paste any URL on your phone—it instantly starts downloading on your PC!

### Download Statistics
Interactive analytics dashboard showing:
- Total data downloaded today, this week, and all-time.
- Daily bandwidth usage charts.
- Top downloaded domains and file categories.

---

## 11. Queues & Scheduling

- **Multiple Queues:** Create distinct queues (e.g. *Night Queue*, *Work Queue*, *Torrents*).
- **Time Scheduler:** Configure downloads to begin automatically at off-peak hours (e.g. 2:00 AM) and halt at 7:00 AM.
- **Post-Download Actions:** Auto-shutdown PC, sleep, or hibernate when the queue completes.
- **Speed Limits:** Set a global speed limit (e.g. 5 MB/s) to keep bandwidth open for streaming and gaming.

---

## 12. Licensing & Activation

### 30-Day Full Feature Trial
Every new installation includes a 30-day unrestricted trial with full access to Turbo Mode, streaming rippers, and up to 32 parallel connections. Trial state is redundantly protected against clock tampering.

### Upgrading to FlowGet Pro
1. Click **Help** -> **Activate License** or click the **Upgrade Premium** card.
2. Purchase a lifetime license key securely via Razorpay.
3. Paste your license key (`FLOWGET-XXXX-XXXX-XXXX`).
4. FlowGet cryptographically verifies the Ed25519 digital signature offline—no internet required to validate.
5. Each license allows activation on **2 personal PCs** with instant online license transfer.

---

## 13. Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Ctrl + N` | Open Add Download Dialog |
| `Ctrl + A` | Select All Downloads in List |
| `Delete` | Remove Selected Downloads |
| `Shift + Delete` | Remove Download and Delete File from Disk |
| `Space` | Pause / Resume Selected Download |
| `Ctrl + F` | Focus Search Box |
| `Ctrl + Q` | Open Queue Manager |
| `Ctrl + ,` | Open Settings / Preferences |
| `F5` | Refresh Download Table |
| `Alt + Enter` | View Selected Download Properties |

---

## 14. Troubleshooting & FAQ

### Q: A download link expired. Do I have to start over?
**A:** No! Right-click the paused download in the table and select **Refresh Download Address**. Paste the new URL from your browser. FlowGet verifies the file size and resumes exactly from where it stopped.

### Q: Why does my browser download the file instead of FlowGet?
**A:** Ensure the FlowGet browser extension is enabled and that the native messaging host was registered. You can re-register the host anytime by opening **Settings** -> **Browser Integration** -> **Re-register Host**. Alternatively, hold `Alt` while clicking only if you want to bypass FlowGet.

### Q: Does FlowGet support resuming on all websites?
**A:** FlowGet supports resume on any server that advertises `Accept-Ranges: bytes` (over 99% of modern servers and CDNs). If a server strictly disallows range requests, FlowGet will notify you that the download cannot be resumed if interrupted.

---

*Thank you for choosing FlowGet! For updates, bug reports, and suggestions, visit our official repository or contact support.*
