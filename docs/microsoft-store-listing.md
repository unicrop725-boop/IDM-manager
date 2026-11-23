# FlowGet - Microsoft Store Listing & MSIX Submission Guide

This document contains all metadata, marketing copy, feature highlights, system requirements, keywords, and packaging instructions required to submit **FlowGet** to the **Microsoft Store (Partner Center)**.

---

## 1. Store Product Overview

- **App Name**: FlowGet Download Manager
- **Category**: Productivity / Developer Tools
- **Subcategory**: Utilities & Tools
- **Pricing**: Free 30-Day Trial, ₹999 / $19.99 USD Lifetime Pro
- **Age Rating**: Everyone / 3+ (PEGI 3, ESRB Everyone)
- **Supported Languages**: English (United States), Hindi (हिन्दी), Gujarati (ગુજરાતી)

---

## 2. Marketing Copy & Descriptions

### Short Description (Up to 100 characters)
> The ultra-fast, modern download manager for Windows with Turbo Mode bonding and stream ripping.

### Full Store Description (Up to 10,000 characters)
```text
FlowGet is the next-generation download accelerator and manager built from the ground up with a Rust core engine and modern desktop UI. Engineered to replace legacy download managers, FlowGet splits files into dynamic multi-segmented streams, bonds multiple network adapters simultaneously in Turbo Mode, and intercepts browser downloads with single-click ease.

Whether you are downloading massive game archives, 4K video streams, software ISOs, or large datasets, FlowGet delivers maximum hardware throughput with zero bloat.

KEY HIGHLIGHTS:

🚀 10X DOWNLOAD ACCELERATION
• Multi-connection segmented downloading up to 32 parallel TCP streams.
• Adaptive AIMD dynamic chunk rebalancing: slow connections are divided and distributed to fast connections on the fly.
• Turbo Mode Network Bonding: Combine your Wi-Fi and Ethernet connections simultaneously to achieve combined aggregated bandwidth.

🎬 ADVANCED STREAMING & MEDIA CAPTURE
• Direct non-DRM HLS (.m3u8) and DASH (.mpd) multi-segment downloads merged losslessly with bundled high-speed FFmpeg.
• In-app video resolution picker: Download videos in 4K, 1080p, 720p, or convert straight to audio MP3/M4A.

🌐 SEAMLESS BROWSER INTEGRATION
• Universal browser extension for Google Chrome, Microsoft Edge, Brave, and Mozilla Firefox.
• Instant one-click capture with cookie and session forwarding for password-protected file lockers.
• Right-click to download, batch capture all media on a webpage, or use floating overlay buttons over video players.

🧲 MULTI-PROTOCOL POWER
• Native support for HTTP, HTTPS, FTP, FTPS, SFTP, and BitTorrent / Magnet links in a single unified interface.
• Batch downloader with wildcard syntax: download entire sequences like image[001-100].jpg automatically.
• Built-in Site Grabber: mirror web folders and extract files with configurable crawl depth.

💡 INTELLIGENCE BEYOND IDM
• Built-in Speed Test measuring ping, download speed, and upload speed with saved historical logs.
• Disk Cleaner utility: finds duplicate files, leftover temporary chunks, and old completed files to free up disk space.
• Resume on restart: downloads that were running when you closed FlowGet carry on by themselves, and passwords are kept in the Windows Credential Manager.
• Smart Naming: Automatically strips messy URL encoding (%20), tracking query parameters, and random generated hash strings.
• Laptop Battery Saver: Pauses heavy downloading automatically when battery level drops below 20%.

🔒 PRIVACY FIRST & NO ADS
• No adware, no tracking telemetry, and no bundled third-party junk.
• 100% offline license key verification using cryptographic Ed25519 signatures.
• Opt-in anonymous crash reporting with automatic PII and file path redaction.
```

---

## 3. Search Keywords & Tags
- `download manager`
- `download accelerator`
- `idm alternative`
- `fast downloader`
- `torrent client`
- `video downloader`
- `turbo download`
- `network bonding`

---

## 4. System Capabilities & Requirements

| Property | Minimum Requirement | Recommended |
|---|---|---|
| **OS Version** | Windows 10 Version 1809 (Build 17763) or higher | Windows 11 Version 22H2 or higher |
| **Architecture** | x64, ARM64 | x64, ARM64 |
| **Memory** | 2 GB RAM | 4 GB+ RAM |
| **Storage** | 150 MB available space | High-speed SSD |
| **Network** | Broadband Internet connection | Dual-adapter (Ethernet + Wi-Fi) for Turbo Mode |

---

## 5. MSIX Packaging Instructions

To publish directly to Microsoft Store without requiring an external installer:

1. **Build the Release Executable**:
   ```powershell
   npm run build
   cd src-tauri
   cargo build --release
   ```
2. **Package as MSIX using Microsoft MSIX Packaging Tool or `cargo-tauri`**:
   ```powershell
   npx @tauri-apps/cli build --bundles appimage,nsis,msi
   ```
   Or use the **Windows App SDK MakeAppx tool**:
   ```powershell
   MakeAppx.exe pack /d "dist_folder" /p "FlowGet_Store_x64.msix"
   ```
3. Upload `FlowGet_Store_x64.msix` in **Microsoft Partner Center** -> **Packages**.
