---
title: "Download link expired or 403 error? Causes and fixes"
description: "Why a download works for a while and then fails with 403 Forbidden, 'link expired' or saves a web page instead of the file, and what to do about it."
pubDate: 2026-11-23T08:30:00Z
tags: ["troubleshooting", "errors", "resume"]
cover: "/img/blog/download-link-expired-403-error-fix.jpg"
coverAlt: "A broken chain link next to a 403 error badge"
faq:
  - q: "What does a 403 Forbidden error mean for a download?"
    a: "The server understood your request but refuses it. For downloads it usually means the link has expired, you are not signed in, or the site blocks requests that do not look like a normal browser visit."
  - q: "Why does the file I downloaded contain a web page?"
    a: "The server answered with an HTML page, usually a login or error page, and the program saved it under the file name. Open the link in your browser, sign in, and download again."
  - q: "Can I continue a download after the link expired?"
    a: "Often yes. If you get a fresh link to the same file, a download manager can check that it is the same size and version and continue from where it stopped."
---

You click a download and it starts. Ten minutes later it fails with "403 Forbidden", "Forbidden", "Link expired", or you end up with a tiny file that will not open. Nothing is wrong with your PC. These are some of the most common download problems, and they have a few clear causes.

## Cause 1: the link is temporary

Many sites do not give you a permanent address. They generate a **signed link** that contains a token or a time stamp and only works for a short time, from a few minutes to a few hours. After that the server refuses it with 403 (sometimes 410 Gone). Large downloads that start late in the validity window can run out of time halfway.

**Fix:** go back to the page where you found the file, click download again to get a new link, and start again. If the download had progressed, see below for continuing it.

## Cause 2: you need to be signed in

Files that sit behind a login (a cloud account, a members area, a purchase) are only given to browsers that carry your login cookie. A separate program asking for the same address has no cookie, so the server answers 403, or sends the login page instead of the file.

**Fix:** download through your browser, or use a download manager with a browser extension that passes your session along with the request. BoltGrab's extension does this, so files behind a sign-in work.

## Cause 3: the server checks who is asking

Some servers refuse requests without a proper **referer** (the page you came from) or that do not look like a normal browser. A plain link pasted into another program lacks both.

**Fix:** start the download from the page itself, so the referer and headers are sent. With a download manager extension, the page's details are captured automatically.

## Cause 4: you are making too many requests

Some servers limit connections per user. Opening many at once can lead to 429 "Too many requests" or 503 errors, and sometimes to 403. A sensible download manager backs off when the server pushes back and tries again with fewer connections.

**Fix:** wait a minute and retry, or limit the number of connections for that site.

## Cause 5: the file moved or changed

A 404 means the file is gone. A different problem is a file that was replaced by a new version in the middle of your download: continuing would mix two files. Programs that check the size and version tag will stop and tell you.

**Fix:** restart the download to get the new version.

## "My download is a web page"

If the saved file is only a few kilobytes, open it in a text editor. If you see HTML (`<html>`, `<body>`), the server sent a page instead of the file, almost always a login or error page. BoltGrab detects this and stops with a clear message instead of saving the page under the wrong name. Sign in in your browser and download it from there.

## Continuing an expired download

If you already had most of a large file, you do not have to throw it away:

1. Get a fresh link to the same file.
2. In BoltGrab, use **Refresh download address** on the download and paste the new link.
3. BoltGrab checks that the new link is for the same file (size, version tag) and continues from the saved bytes.

Without that check, it would be impossible to know if the new link is the same file. Read more in [how to resume a broken download](/blog/how-to-resume-a-broken-download/).

## Quick troubleshooting list

1. Open the page again and get a new link.
2. Make sure you are signed in, and download from the browser or through an extension.
3. Wait a few minutes if you see 429 or 503.
4. Check the saved file's size: a tiny file means a web page was saved.
5. Verify files you downloaded with a [checksum](/blog/how-to-check-a-downloaded-file-is-safe/).
