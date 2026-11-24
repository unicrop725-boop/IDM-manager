---
title: "How to resume a broken download on Windows (without starting over)"
description: "Why downloads stop halfway, when they can be resumed, and how to continue from where they stopped instead of downloading the whole file again."
pubDate: 2026-11-23T09:00:00Z
tags: ["resume", "windows", "troubleshooting"]
cover: "/img/blog/how-to-resume-a-broken-download.jpg"
coverAlt: "A download progress bar that stops partway and then continues"
featured: true
faq:
  - q: "Can every broken download be resumed?"
    a: "No. A download can only continue if the server supports byte-range requests and the file has not changed since you started. Most large file hosts support ranges; some dynamic or protected downloads do not."
  - q: "Why does my browser say 'Failed - Network error' at 98%?"
    a: "The connection dropped before the last bytes arrived. Browsers often keep the partial file, but if the link was temporary or the file changed on the server, the only option is to start again."
  - q: "Is it safe to resume a download?"
    a: "Yes, if the program checks that the file on the server is still the same one. A good download manager compares the size and a version tag (ETag or last-modified date) before continuing, so you never end up with two different files stitched together."
---

A download that dies at 90% is one of the most irritating things a computer does. The good news: in many cases you do not have to start over. Here is why downloads break, when they can continue from where they stopped, and what to do when they cannot.

## Why downloads stop halfway

A file download is a long conversation between your PC and a server. Anything that interrupts that conversation ends it:

- **Your connection drops.** Wi-Fi hiccups, a router restart, a VPN reconnecting or the PC going to sleep.
- **The server gives up.** Servers close connections that are idle too long, or limit how many you can open at once.
- **The link expires.** Many sites use temporary signed links that stop working after minutes or hours. (See [why download links expire](/blog/download-link-expired-403-error-fix/).)
- **The app closes.** A browser crash or an update restart ends all its downloads.

## How resuming works

Resuming relies on a feature of the web called a **range request**. Instead of asking for the whole file, your program asks for "bytes 4,000,000 to the end". If the server answers with a partial response (status code 206), the download can continue from exactly where it stopped.

For this to be safe, two things must hold:

1. **The server supports ranges.** It announces this with an `Accept-Ranges: bytes` header.
2. **The file has not changed.** Programs check the file size and a version tag (the `ETag` or `Last-Modified` header). If those differ, the bytes you already have belong to a different file, and continuing would corrupt it.

## Try this first: resume in your browser

Most browsers keep a partial download and offer a resume option:

1. Open the downloads page (press `Ctrl + J` in Chrome and Edge).
2. If you see a **Resume** button next to the failed file, click it.
3. If it only offers **Retry** or the file starts from 0%, the link expired or the server does not support ranges.

Browsers can only resume when the original link still works, which is exactly the case that often fails.

## Why a download manager resumes more reliably

A dedicated download manager is built around the idea that connections fail:

- It **saves progress continuously** and flushes the data to disk, so a crash or power cut loses at most a moment of work.
- It **checks the file is unchanged** before continuing, and tells you clearly if it is not.
- It **waits for the internet** instead of failing: when your connection drops, it parks the download and continues automatically when you are back online.
- It can **refresh an expired link** by reopening the original page and verifying it is the same file.

FlowGet does all of this. Downloads that were running when you closed the app, restarted Windows or lost power continue by themselves the next time it starts, and downloads you paused yourself stay paused. You can read the details on the [features page](/features/#engine).

## When resuming is not possible

Sometimes starting over is the only choice:

- **The server does not support ranges.** The download restarts from zero every time. A download manager will show a "Resume not supported" notice so you know in advance.
- **The file changed.** The site replaced the file with a new version. Resuming would mix two files, so a careful program stops and tells you.
- **The link is dead.** Go back to the page where you found the download, get a fresh link, and download again. In FlowGet you can paste the new link into the existing download if it is the same file, and it continues from where it stopped.

## A short checklist

1. Check your internet connection and try again.
2. In your browser, look for **Resume** in the downloads list.
3. If the link expired, return to the download page and get a new one.
4. For large files or unreliable connections, use a download manager so interruptions stop mattering.
5. After downloading, verify the file with its published checksum. Our guide on [checking a downloaded file](/blog/how-to-check-a-downloaded-file-is-safe/) shows how.
