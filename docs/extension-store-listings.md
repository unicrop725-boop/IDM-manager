# FlowGet Browser Extension - Store Listings (Chrome Web Store & Edge Add-ons)

This document contains metadata, permission declarations, single purpose descriptions, and review answers for publishing the **FlowGet Browser Extension** on the **Chrome Web Store** and **Microsoft Edge Add-ons Store**.

---

## 1. Extension Store Metadata

- **Name**: FlowGet Download Interceptor & Media Grabber
- **Short Name**: FlowGet
- **Category**: Productivity / Accessibility
- **Default Locale**: English (`en`)
- **Website**: `https://flowget.net`
- **Support Contact**: `support@flowget.net`
- **Privacy Policy URL**: `https://flowget.net/privacy`

---

## 2. Store Descriptions

### Short Summary (Up to 132 characters)
> Capture downloads in one click, rip streaming videos, and accelerate downloads seamlessly with the FlowGet Desktop App.

### Detailed Description
```text
The official companion extension for the FlowGet Download Manager on Windows.

FlowGet Download Interceptor automatically catches download links from Google Chrome, Microsoft Edge, Brave, and other Chromium browsers, sending them directly into the ultra-fast FlowGet engine with full session cookie and referer preservation.

KEY FEATURES:

⚡ Automatic Download Interception
• Captures browser downloads automatically according to your customizable file type filters.
• Seamlessly transfers authenticated cookies and headers so downloads from login-protected cloud drives and file lockers work on the first try.
• Hold 'Alt' while clicking any download link to bypass capture and download directly in browser.

🎥 Video & Streaming Media Detector
• Detects video streams, non-DRM HLS (.m3u8), and DASH (.mpd) manifests playing on webpages.
• Displays a floating, non-intrusive 'Download This Video' button on video players with full quality selection (4K, 1080p, 720p, or Audio MP3).

📋 Right-Click Context Menus
• 'Download with FlowGet': Right-click any link, image, or media file to download instantly.
• 'Download all links with FlowGet': Batch grabs all links and media on the active webpage, allowing you to filter by extension (ZIP, PDF, ISO, etc.).

🔐 Local Secure Communication
• Communicates with the FlowGet Desktop App through standard Chrome Native Messaging.
• No remote ad servers, zero third-party telemetry, and zero tracking.

NOTE: This extension requires the FlowGet Desktop App installed on your PC. Download the free desktop app from https://flowget.net
```

---

## 3. Chrome Web Store Permission Justifications (Single Purpose Policy)

Google review guidelines require specific explanations for every requested permission in `manifest.json`:

| Permission | Reviewer Explanation / Justification |
|---|---|
| `downloads` | Required to intercept browser downloads (`chrome.downloads.onDeterminingFilename`), cancel the standard slow browser download, and pass the URL and metadata to FlowGet. |
| `webRequest` | Required to inspect HTTP media headers and discover embedded HLS (`.m3u8`) and DASH (`.mpd`) video stream segments requested by video players. |
| `nativeMessaging` | Required to establish a secure, local IPC communication channel to the installed FlowGet desktop engine via the native messaging host executable. |
| `contextMenus` | Required to add 'Download with FlowGet' and 'Download All Links on Page' actions to the right-click menu. |
| `cookies` | Required to extract active session authentication cookies for the requested download domain, ensuring login-protected files can be downloaded by the desktop manager without 403 Forbidden errors. |
| `<all_urls>` (Host Permissions) | Needed to detect downloadable media and intercept download URLs across any website the user visits. |

---

## 4. Single Purpose Declaration
> *"The FlowGet extension serves a single purpose: to capture download URLs and stream manifests from the web browser and transfer them to the FlowGet desktop download engine for multi-threaded acceleration."*

---

## 5. Reviewer Demonstration Notes
- How to test:
  1. Install the FlowGet desktop application.
  2. Install this extension.
  3. Navigate to any file download (e.g. `https://releases.ubuntu.com`) and click an ISO link.
  4. The browser download is smoothly intercepted and the FlowGet Add Download dialog appears on the desktop with matching cookies and URL.
