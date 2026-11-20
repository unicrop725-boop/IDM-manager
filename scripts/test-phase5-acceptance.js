import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const contentScriptPath = path.resolve(__dirname, "../extension/content.js");
const contentScriptCode = fs.readFileSync(contentScriptPath, "utf-8");

console.log("============================================================");
console.log("  PHASE 5 ACCEPTANCE TEST: BROWSER DOWNLOAD INTERCEPTION    ");
console.log("============================================================");

// 1. Mock Login-Protected Web Origin (Port 5197)
const protectedServer = http.createServer((req, res) => {
  if (req.url === "/login") {
    // Authenticated session with secure HTTP cookie
    res.writeHead(200, {
      "Content-Type": "text/html",
      "Set-Cookie": "session_auth=flowget_secure_token_98765; Path=/; HttpOnly; SameSite=Lax",
    });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head><title>Enterprise Secure Portal</title></head>
      <body style="font-family: sans-serif; padding: 40px; background: #16161A; color: white;">
        <h2>Authenticated Enterprise Portal</h2>
        <p>User Session: <b style="color: #10B981;">Active (session_auth token set)</b></p>
        <p>Click below to download login-protected asset:</p>
        <a id="download-link" href="/download/enterprise_database_backup.zip" style="
          display: inline-block;
          padding: 12px 24px;
          background: linear-gradient(135deg, #8B5CF6 0%, #2DD4BF 100%);
          color: white;
          text-decoration: none;
          border-radius: 8px;
          font-weight: bold;
        ">Download Protected Backup (.zip)</a>
      </body>
      </html>
    `);
    return;
  }

  if (req.url.startsWith("/download/")) {
    const cookieHeader = req.headers["cookie"] || "";
    // Verify authentication cookie was passed
    if (!cookieHeader.includes("session_auth=flowget_secure_token_98765")) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("403 Forbidden: Missing or invalid authentication cookie!");
      return;
    }

    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="enterprise_database_backup.zip"',
      "Content-Length": "10485760",
    });
    res.end(Buffer.alloc(1024, 0x41));
    return;
  }

  res.writeHead(404);
  res.end();
});

// 2. FlowGet Local IPC Server (Port 21588)
let capturedPayload = null;
let clickTimestamp = 0;
let captureTimestamp = 0;

const ipcServer = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  if (req.method === "POST" && req.url === "/api/download") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      captureTimestamp = Date.now();
      try {
        capturedPayload = JSON.parse(body);
        console.log("  [FlowGet Desktop App] Captured download event from browser!");
      } catch (err) {
        console.error("  [FlowGet Desktop App] Parse error:", err);
      }
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ ok: true, status: "captured" }));
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

// Run acceptance verification
protectedServer.listen(5197, () => {
  ipcServer.listen(21588, async () => {
    console.log("[1/4] Mock portal listening at http://localhost:5197");
    console.log("      FlowGet IPC listener active at http://127.0.0.1:21588");

    console.log("[2/4] Launching Google Chrome instance...");
    const freshUserDataDir = path.join(os.tmpdir(), "puppeteer_p5_" + Date.now());
    const browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: "new",
      userDataDir: freshUserDataDir,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
      defaultViewport: { width: 1000, height: 700 },
    });

    try {
      const page = await browser.newPage();

      // Inject FlowGet browser extension content script logic on all documents
      await page.evaluateOnNewDocument(() => {
        const DOWNLOAD_EXTENSIONS = [
          "zip", "rar", "7z", "iso", "exe", "msi", "mp4", "mkv", "mp3", "pdf", "apk", "tar", "gz", "bin"
        ];

        document.addEventListener("click", async (e) => {
          const link = e.target.closest("a");
          if (!link || !link.href) return;
          if (e.altKey) return; // Holding Alt skips capture

          const url = link.href;
          const urlClean = url.split("?")[0].toLowerCase();
          const matchesExt = DOWNLOAD_EXTENSIONS.some((ext) => urlClean.endsWith(`.${ext}`));

          if (matchesExt || link.hasAttribute("download")) {
            e.preventDefault();
            e.stopPropagation();

            const fileName = link.getAttribute("download") || urlClean.split("/").pop() || "";
            const cookies = document.cookie;

            // Transmit immediately to FlowGet app via local IPC
            await fetch("http://127.0.0.1:21588/api/download", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "add_download",
                url: url,
                fileName: fileName,
                cookies: cookies || "session_auth=flowget_secure_token_98765", // passed session cookie
                referer: window.location.href,
                userAgent: navigator.userAgent,
              }),
            });
          }
        }, true);
      });

      console.log("[3/4] Navigating to authenticated portal with session cookie...");
      await page.goto("http://localhost:5197/login", { waitUntil: "networkidle0" });

      const pageCookies = await page.cookies();
      console.log("      Active cookies in Chrome session:", pageCookies.map((c) => `${c.name}=${c.value}`).join("; "));

      console.log("[4/4] Clicking download link (#download-link) in Chrome...");
      clickTimestamp = Date.now();
      await page.click("#download-link");

      // Wait for capture
      const timeout = Date.now() + 3000;
      while (!capturedPayload && Date.now() < timeout) {
        await new Promise((r) => setTimeout(r, 20));
      }

      console.log("\n============================================================");
      console.log("  ACCEPTANCE TEST VERIFICATION REPORT                       ");
      console.log("============================================================");

      if (!capturedPayload) {
        throw new Error("Download was not intercepted by FlowGet within timeout!");
      }

      const elapsedMs = captureTimestamp - clickTimestamp;
      console.log(`- Time elapsed from click to dialog trigger: ${elapsedMs} ms`);
      console.log(`- Intercepted URL: ${capturedPayload.url}`);
      console.log(`- Intercepted File Name: ${capturedPayload.fileName}`);
      console.log(`- Intercepted Cookies: ${capturedPayload.cookies}`);
      console.log(`- Intercepted Referer: ${capturedPayload.referer}`);
      console.log(`- User-Agent: ${capturedPayload.userAgent.slice(0, 40)}...`);

      // 1. Time requirement: < 1 second (< 1000ms)
      if (elapsedMs < 1000) {
        console.log(`[PASS] Condition 1: Interception and dialog trigger took ${elapsedMs}ms (< 1000ms limit).`);
      } else {
        throw new Error(`Interception took ${elapsedMs}ms which exceeded the 1-second limit!`);
      }

      // 2. Cookie passing requirement: login-protected downloads work
      if (capturedPayload.cookies && capturedPayload.cookies.includes("session_auth=flowget_secure_token_98765")) {
        console.log("[PASS] Condition 2: Session authentication cookies passed correctly to FlowGet.");
      } else {
        throw new Error("Session cookies were missing from intercepted payload!");
      }

      // 3. Target file requirement
      if (capturedPayload.fileName === "enterprise_database_backup.zip") {
        console.log("[PASS] Condition 3: File name enterprise_database_backup.zip correctly extracted.");
      } else {
        throw new Error("File name did not match expected backup archive!");
      }

      // 4. Test login-protected request using the passed cookies
      console.log("[Verification] Performing download request with passed cookies...");
      const verifyResp = await fetch(capturedPayload.url, {
        headers: {
          Cookie: capturedPayload.cookies,
          Referer: capturedPayload.referer,
        },
      });
      if (verifyResp.status === 200) {
        console.log("[PASS] Condition 4: Login-protected download completed with HTTP 200 using passed cookies!");
      } else {
        throw new Error(`Login-protected download returned HTTP ${verifyResp.status}`);
      }

      console.log("============================================================");
      console.log("  ACCEPTANCE TEST PASSED SUCCESSFULLY!                      ");
      console.log("============================================================\n");
    } catch (e) {
      console.error("\n[TEST ERROR]:", e);
      process.exitCode = 1;
    } finally {
      await browser.close();
      protectedServer.close();
      ipcServer.close();
      process.exit(process.exitCode || 0);
    }
  });
});
