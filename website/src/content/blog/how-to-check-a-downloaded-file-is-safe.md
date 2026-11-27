---
title: "How to check if a downloaded file is safe: 5 quick checks"
description: "Five quick checks before you run a download: the source, the file name, the checksum, a VirusTotal lookup and Windows SmartScreen, with the commands to use."
pubDate: 2026-11-23T06:00:00Z
tags: ["safety", "windows", "security"]
cover: "/img/blog/how-to-check-a-downloaded-file-is-safe.jpg"
coverAlt: "A shield with a check mark between two files"
faq:
  - q: "How do I get the SHA-256 of a file on Windows?"
    a: "Open PowerShell in the folder and run: Get-FileHash .\\file.exe -Algorithm SHA256. Compare the result with the hash published by the software's author."
  - q: "Does uploading a file to VirusTotal make it public?"
    a: "Files you upload to VirusTotal can be seen by its security partners. Looking up a file by its hash does not upload the file at all, which is the safer first step."
  - q: "Is a program safe if VirusTotal shows no detections?"
    a: "It is a good sign, not a guarantee. New or targeted malware may not be detected yet. Combine the lookup with a trustworthy source and a matching checksum."
---

Most malware does not arrive through clever hacking. It arrives because somebody ran a file they should not have. A few minutes of checking before you open a download removes most of the risk. These are the five checks worth making a habit.

## 1. Check the source

The single best protection is downloading from the right place: the author's own website, an official store, or a well-known project page. Be wary of:

- search ads that look like the official download page
- "mirror" sites wrapped around the same installer
- download buttons that are really adverts
- links shared in messages from people you do not know

If you keep a list of sites you trust, you will make fewer mistakes. BoltGrab's *Trusted Sites* page is a curated list for exactly this.

## 2. Read the file name properly

Windows hides known file extensions by default, which attackers exploit. A file named `invoice.pdf.exe` shows up as `invoice.pdf` and looks like a document, but it is a program.

1. In File Explorer, choose **View > Show > File name extensions**.
2. Look at the **last** extension. Only that one counts.
3. Treat these as programs: `.exe`, `.msi`, `.bat`, `.cmd`, `.scr`, `.js`, `.vbs`, `.ps1`, `.jar`, `.lnk`.

Another trick uses a hidden character that reverses text, so `invoicefdp.exe` is displayed as `invoiceexe.pdf`. And long runs of spaces can push the real ending out of sight: `report.pdf          .exe`. BoltGrab warns about double extensions, extra spaces and reversed names, and asks before opening such a file.

## 3. Compare the checksum

A checksum (hash) is a fingerprint of a file. If even one byte changes, the fingerprint changes completely. Reputable projects publish the SHA-256 of their downloads.

In PowerShell, in the folder with the file:

```
Get-FileHash .\setup.exe -Algorithm SHA256
```

Or in Command Prompt:

```
certutil -hashfile setup.exe SHA256
```

Compare the result with the one on the official page. If they match, the file is the one the author published. If they differ, delete it and download again from the official source. (The hash only proves the file is unchanged; the page publishing it must be the real one.)

## 4. Look the hash up on VirusTotal

VirusTotal runs files past dozens of antivirus engines. You do not have to upload anything: search for the file's **SHA-256** on virustotal.com and it will show whether the file has been seen and how many engines flag it.

How to read the result:

- **Many detections:** do not run it.
- **One or two detections:** often a false alarm, but look at which engines and read the comments.
- **"Not found":** nobody has scanned this exact file. That is normal for new or rare files, and it is not proof of safety.

If you let BoltGrab do the lookup (add your own free VirusTotal key in *Options > Safety*), it sends only the fingerprint, never the file, and shows the result next to your download.

## 5. Heed Windows SmartScreen, and use your antivirus

When Windows says "Windows protected your PC", it is telling you that it does not know this program. New software often triggers it, which is not proof of malware. But it is a reason to go back to steps 1 to 4 before you click **Run anyway**. Keep Microsoft Defender (or your antivirus) switched on and updated, and scan downloaded programs before you run them.

## What if the "file" is not a file?

Sometimes a download is not malware, just wrong: the site sends a login page or error page where the file should be, and the browser saves it with the file's name. The result is a tiny file that will not open. BoltGrab detects this and tells you the server sent a web page, so you can sign in and try again. Our guide to [expired links and 403 errors](/blog/download-link-expired-403-error-fix/) explains the usual causes.

## A 30-second routine

1. Is this the official site?
2. Does the **last** extension match what I expected?
3. Does the checksum match, if one is published?
4. Does VirusTotal know the file, and is it clean?
5. Am I running it with antivirus on?

If any answer is "no" or "not sure", stop and check before you open it.
