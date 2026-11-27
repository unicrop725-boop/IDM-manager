// scripts/test-website-csp.mjs
// Loads EVERY built page in headless Chrome with the exact per-page headers from website/dist/_headers and checks that
//  (1) no page breaks under its own Content-Security-Policy, (2) nothing talks to unexpected hosts,
//  (3) the policy really blocks injected inline scripts, eval and foreign scripts, and
//  (4) hostile user data (name, review text) is shown as plain text by the real account and admin pages.
// Local only. The script starts its own API on port 4243 (throwaway databases), so it never touches a server you run.
//   cd website && PUBLIC_API_URL=http://localhost:4243 npm run build && cd .. && node scripts/test-website-csp.mjs
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(here, "../website/dist");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 4400; // listed in the server's default allowed origins
const BASE = `http://localhost:${PORT}`;
const API_PORT = 4243;
const API = `http://localhost:${API_PORT}`;
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `localhost:${API_PORT}`, "accounts.google.com", "www.gstatic.com", "ssl.gstatic.com", "fonts.gstatic.com", "flagcdn.com"]);

if (!fs.existsSync(path.join(DIST, "_headers"))) throw new Error("website/dist/_headers is missing: build the website first");

// ---- parse Cloudflare-style _headers
function parseHeaders(text) {
  const rules = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      cur = { pattern: line.trim(), ops: [] };
      rules.push(cur);
    } else if (cur) {
      const t = line.trim();
      if (t.startsWith("!")) cur.ops.push({ del: t.slice(1).trim().toLowerCase() });
      else {
        const i = t.indexOf(":");
        cur.ops.push({ set: t.slice(0, i).trim(), value: t.slice(i + 1).trim() });
      }
    }
  }
  return rules;
}
const RULES = parseHeaders(fs.readFileSync(path.join(DIST, "_headers"), "utf8"));
const matches = (pattern, p) => (pattern.endsWith("*") ? p.startsWith(pattern.slice(0, -1)) : p === pattern);
function headersFor(p) {
  const h = {};
  for (const r of RULES) {
    if (!matches(r.pattern, p)) continue;
    for (const op of r.ops) {
      if (op.del) delete h[op.del];
      else h[op.set.toLowerCase()] = op.value;
    }
  }
  return h;
}
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".xml": "application/xml", ".txt": "text/plain", ".ico": "image/x-icon", ".mp4": "video/mp4" };

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, BASE).pathname);
  let file = path.join(DIST, p);
  if (!file.startsWith(DIST)) {
    res.writeHead(403);
    return res.end();
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) {
    res.writeHead(404, { "Content-Type": "text/html" });
    return res.end("<h1>404</h1>");
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", ...headersFor(p) });
  fs.createReadStream(file).pipe(res);
});

const pages = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name === "index.html" && !full.includes(`${path.sep}app-demo${path.sep}assets`)) {
      const rel = path.relative(DIST, path.dirname(full)).split(path.sep).filter(Boolean).join("/");
      pages.push("/" + (rel ? rel + "/" : ""));
    }
  }
})(DIST);
pages.sort();

let passed = 0;
let failed = 0;
const ok = (name) => (passed++, console.log("  ok  " + name));
const bad = (name, why) => (failed++, console.error("FAIL  " + name + "\n      " + why), (process.exitCode = 1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

// ---- our own API, so the sign-in / account / admin pages have something real to talk to
const WHSEC = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
const apiTmp = fs.mkdtempSync(path.join(os.tmpdir(), "fg-csp-api-"));
const apiChild = spawn(process.execPath, [path.resolve(here, "../server/license-server.cjs")], {
  env: { ...process.env, PORT: String(API_PORT), HOST: "127.0.0.1", ALLOWED_ORIGINS: BASE, ADMIN_EMAILS: "boss@example.com", AUTH_DEV_GOOGLE: "1", DODO_WEBHOOK_SECRET: "whsec_" + WHSEC, DODO_PRODUCT_ID: "pdt_x", LICENSES_DB: path.join(apiTmp, "l.json"), ACCOUNTS_DB: path.join(apiTmp, "a.json"), BLOG_DIR: path.join(apiTmp, "blog"), BLOG_IMG_DIR: path.join(apiTmp, "img") },
  stdio: ["ignore", "ignore", "ignore"],
});
for (let i = 0; i < 50; i++) {
  if (await fetch(API + "/api/health").then((r) => r.ok).catch(() => false)) break;
  await sleep(200);
}
if (!(await fetch(API + "/api/health").then((r) => r.ok).catch(() => false))) {
  apiChild.kill();
  throw new Error("the test API did not start on port " + API_PORT);
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "fg-csp-"));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", userDataDir: profile, args: ["--no-first-run", "--disable-extensions", "--no-sandbox"] });

console.log(`Website CSP / browser tests (${pages.length} pages)\n`);
try {
  // ---------------------------------------------------------------- every page under its real CSP
  for (const p of pages) {
    const page = await browser.newPage();
    const problems = [];
    const hosts = new Set();
    page.on("dialog", async (d) => {
      problems.push("a dialog opened: " + d.message());
      await d.dismiss();
    });
    page.on("pageerror", (e) => problems.push("page error: " + String(e.message).slice(0, 160)));
    page.on("console", (m) => {
      if (m.type() === "error" && !/Failed to load resource|ERR_(NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|CONNECTION|BLOCKED_BY_CLIENT)|net::/.test(m.text())) problems.push("console: " + m.text().slice(0, 200));
    });
    page.on("request", (r) => {
      try {
        const u = new URL(r.url());
        if (u.protocol.startsWith("http")) hosts.add(u.host);
      } catch {}
    });
    await page.evaluateOnNewDocument(() => {
      window.__csp = [];
      document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} blocked ${e.blockedURI || "inline"} (${(e.sample || "").slice(0, 40)})`));
    });
    try {
      await page.goto(BASE + p, { waitUntil: "networkidle2", timeout: 30000 });
    } catch (e) {
      problems.push("did not load: " + e.message);
    }
    await sleep(400);
    const violations = await page.evaluate(() => window.__csp || []).catch(() => []);
    const stray = [...hosts].filter((h) => !ALLOWED_HOSTS.has(h));
    const csp = headersFor(p)["content-security-policy"] || "";
    if (!csp) problems.push("no Content-Security-Policy applies to this page");
    if (!/frame-ancestors/.test(csp)) problems.push("CSP has no frame-ancestors (clickjacking)");
    if (/script-src[^;]*'unsafe-(inline|eval)'/.test(csp)) problems.push("script-src allows unsafe-inline/unsafe-eval");
    if (violations.length) problems.push("CSP violations: " + violations.slice(0, 3).join(" | "));
    if (stray.length) problems.push("requests to unexpected hosts: " + stray.join(", "));
    problems.length ? bad(p, problems.join("\n      ")) : ok(p + "  (loads clean under its own policy)");
    await page.close();
  }

  // ---------------------------------------------------------------- the policy must actually stop injected code
  console.log("\nInjection attempts against the live pages");
  for (const p of ["/", "/signin/", "/buy/", "/blog/", "/features/"]) {
    const page = await browser.newPage();
    let dialog = false;
    page.on("dialog", async (d) => ((dialog = true), d.dismiss()));
    await page.evaluateOnNewDocument(() => {
      window.__csp = [];
      document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective));
    });
    await page.goto(BASE + p, { waitUntil: "domcontentloaded" });
    const r = await page.evaluate(async () => {
      const out = {};
      const s = document.createElement("script");
      s.textContent = "window.__pwn = 1";
      document.body.appendChild(s);
      out.inline = window.__pwn === 1;
      const img = document.createElement("img");
      img.src = "x";
      img.setAttribute("onerror", "window.__pwn2 = 1");
      document.body.appendChild(img);
      await new Promise((res) => setTimeout(res, 300));
      out.handler = window.__pwn2 === 1;
      try {
        out.eval = eval("1+1") === 2;
      } catch {
        out.eval = false;
      }
      const f = document.createElement("script");
      f.src = "http://127.0.0.1:9/evil.js";
      document.body.appendChild(f);
      await new Promise((res) => setTimeout(res, 300));
      out.violations = window.__csp.slice();
      return out;
    });
    const failures = [];
    if (r.inline) failures.push("injected inline <script> executed");
    if (r.handler) failures.push("injected onerror handler executed");
    if (r.eval) failures.push("eval() is allowed");
    if (dialog) failures.push("an alert dialog opened");
    if (!r.violations.length) failures.push("no violation was reported at all (is the CSP delivered?)");
    failures.length ? bad(`${p} blocks injected script, handler and eval`, failures.join("; ")) : ok(`${p} blocks injected script, handler and eval`);
    await page.close();
  }

  // ---------------------------------------------------------------- URL-borne payloads must be inert
  console.log("\nURL-borne payloads");
  const payloads = [
    ["/thanks/?order=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E", "order id from the URL"],
    ["/thanks/?order=%22%3E%3Cscript%3Ealert(1)%3C/script%3E", "order id with a script tag"],
    ["/signin/?next=%2F%2Fevil.example", "open redirect via //"],
    ["/signin/?next=%5Cevil.example", "open redirect via backslash"],
    ["/signin/?next=javascript:alert(1)", "javascript: next"],
    ["/blog/?q=%3Cscript%3Ealert(1)%3C/script%3E", "query on the blog"],
    ["/admin/#__proto__", "hash routing to __proto__"],
    ["/admin/#constructor", "hash routing to constructor"],
    ["/account/?x=%3Csvg%20onload%3Dalert(1)%3E#<img src=x onerror=alert(1)>", "svg/img in query and hash"],
  ];
  for (const [url, label] of payloads) {
    const page = await browser.newPage();
    let dialog = "";
    const errors = [];
    page.on("dialog", async (d) => ((dialog = d.message()), d.dismiss()));
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(BASE + url, { waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});
    await sleep(400);
    const where = new URL(page.url());
    const problems = [];
    if (dialog) problems.push("alert opened: " + dialog);
    if (where.host !== `localhost:${PORT}`) problems.push("navigated away to " + where.host);
    if (errors.some((e) => /__proto__|constructor|Cannot read/.test(e))) problems.push("script error: " + errors[0]);
    problems.length ? bad(label, problems.join("; ")) : ok(label);
    await page.close();
  }

  // ---------------------------------------------------------------- stored XSS, end to end through the real pages
  console.log("\nStored XSS end to end (hostile name and review rendered by the real pages)");
  {
    const HOSTILE = '<img src=x onerror="window.__xss=1;alert(1)">Mallory';
    const ROLE = '"><svg onload=alert(3)>';
    const inPage = (page, p, body) =>
      page.evaluate(
        async (u, b) => {
          const r = await fetch(u, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
          return { status: r.status, json: await r.json().catch(() => null) };
        },
        API + p,
        body,
      );
    const signUp = async (page, email, name) => {
      const g = await inPage(page, "/api/auth/google", { credential: `dev:${email}|${name}` });
      const c = await inPage(page, "/api/auth/complete", { setupToken: g.json && g.json.setupToken, name, phone: "+911112223334", password: "Passw0rdOK1" });
      if (c.status !== 200) throw new Error("sign-up failed: " + JSON.stringify(c));
    };
    const watch = (page, bag) => {
      page.on("dialog", async (d) => (bag.dialogs.push(d.message()), d.dismiss()));
      page.on("pageerror", (e) => bag.errors.push(e.message));
    };

    // the hostile user: strange name, buys a license, writes a hostile review
    const ctxA = await browser.createBrowserContext();
    const a = await ctxA.newPage();
    const bagA = { dialogs: [], errors: [] };
    watch(a, bagA);
    await a.goto(BASE + "/signin/", { waitUntil: "domcontentloaded" });
    await signUp(a, "mallory@example.com", HOSTILE);
    const hookBody = JSON.stringify({ type: "payment.succeeded", data: { payment_id: "pay_e2e_1", customer: { email: "mallory@example.com" }, total_amount: 100, currency: "USD", metadata: {} } });
    const hid = "msg_e2e_1";
    const hts = Math.floor(Date.now() / 1000);
    const hsig = crypto.createHmac("sha256", Buffer.from(WHSEC, "base64")).update(`${hid}.${hts}.${hookBody}`).digest("base64");
    const hr = await fetch(API + "/api/webhook/dodo", { method: "POST", headers: { "webhook-id": hid, "webhook-timestamp": String(hts), "webhook-signature": "v1," + hsig }, body: hookBody });
    const rv = await inPage(a, "/api/reviews", { rating: 5, text: "Review text with <script>alert(4)</script> and <img src=x onerror=alert(5)> inside it.", role: ROLE });
    await a.goto(BASE + "/account/", { waitUntil: "networkidle2" });
    await sleep(500);
    const acc = await a.evaluate(() => ({
      nameText: (document.getElementById("a-name") && document.getElementById("a-name").textContent) || "",
      injected: document.querySelectorAll("#a-name img, #a-name script, #a-first img").length,
      xss: window.__xss === 1,
      keys: document.querySelectorAll("code").length,
    }));
    const accProblems = [];
    if (hr.status !== 200) accProblems.push("webhook did not issue the test license: " + hr.status);
    if (rv.status !== 200) accProblems.push("review was not accepted: " + rv.status + " " + JSON.stringify(rv.json));
    if (bagA.dialogs.length) accProblems.push("dialog(s) opened: " + bagA.dialogs.join(" | "));
    if (acc.injected) accProblems.push("hostile name was parsed as HTML on /account/");
    if (acc.xss) accProblems.push("injected handler ran");
    if (!acc.nameText.includes("<img")) accProblems.push("name not shown as literal text: " + JSON.stringify(acc.nameText.slice(0, 40)));
    if (!acc.keys) accProblems.push("license key list did not render (page broken?)");
    accProblems.length ? bad("/account/ shows a hostile name as plain text and still works", accProblems.join("; ")) : ok("/account/ shows a hostile name as plain text and still works");
    await a.close();

    // the admin, looking at the hostile data in every tab
    const ctxB = await browser.createBrowserContext();
    const b = await ctxB.newPage();
    const bagB = { dialogs: [], errors: [] };
    watch(b, bagB);
    await b.goto(BASE + "/signin/", { waitUntil: "domcontentloaded" });
    await signUp(b, "boss@example.com", "The Boss");
    const adminProblems = [];
    for (const tab of ["overview", "users", "purchases", "reviews"]) {
      await b.goto(BASE + "/admin/#" + tab, { waitUntil: "networkidle2" });
      await sleep(700);
      const st = await b.evaluate(() => ({
        imgs: document.querySelectorAll('img[src="x"], svg[onload]').length,
        scripts: [...document.querySelectorAll("script")].filter((x) => /alert\(/.test(x.textContent)).length,
        xss: window.__xss === 1,
        shown: document.body.innerText.includes("Mallory"),
      }));
      if (st.imgs || st.scripts || st.xss) adminProblems.push(`#${tab}: hostile data became live markup (${JSON.stringify(st)})`);
      if (tab === "users" && !st.shown) adminProblems.push("#users did not list the hostile user at all (page broken?)");
    }
    if (bagB.dialogs.length) adminProblems.push("dialog(s) opened in the admin panel: " + bagB.dialogs.join(" | "));
    adminProblems.length ? bad("admin panel shows hostile users and reviews as text only", adminProblems.join("; ")) : ok("admin panel shows hostile users and reviews as text only");

    // approve the hostile review, then check the PUBLIC pages that show reviews
    const approve = await inPage(b, "/api/admin/reviews", { id: (await b.evaluate(async (u) => (await (await fetch(u, { credentials: "include" })).json()).rows[0]?.id, API + "/api/admin/reviews")) || "", action: "approve" });
    await b.close();
    const pub = await browser.newPage();
    const bagP = { dialogs: [], errors: [] };
    watch(pub, bagP);
    const pubProblems = [];
    if (approve.status !== 200) pubProblems.push("could not approve the test review: " + approve.status);
    for (const p of ["/", "/buy/", "/features/"]) {
      await pub.goto(BASE + p, { waitUntil: "networkidle2" });
      await sleep(600);
      const st = await pub.evaluate(() => ({ live: document.querySelectorAll('img[src="x"], svg[onload]').length, xss: window.__xss === 1 }));
      if (st.live || st.xss) pubProblems.push(`${p}: hostile review became live markup`);
    }
    if (bagP.dialogs.length) pubProblems.push("dialog(s) on public pages: " + bagP.dialogs.join(" | "));
    pubProblems.length ? bad("public pages show an approved hostile review as text only", pubProblems.join("; ")) : ok("public pages show an approved hostile review as text only");
    await pub.close();
    await ctxA.close();
    await ctxB.close();
  }

  // ---------------------------------------------------------------- the sign-in redirect rule, exhaustively (same expression as auth.js)
  console.log("\nSign-in redirect rule (same test as public/js/auth.js)");
  const authSrc = fs.readFileSync(path.resolve(here, "../website/public/js/auth.js"), "utf8");
  if (!authSrc.includes('/^\\/[A-Za-z0-9]/.test(n)') || !authSrc.includes('n.indexOf("//") < 0') || !authSrc.includes('n.indexOf("\\\\") < 0')) {
    bad("redirect rule found in auth.js", "the expected next-URL check was not found; re-check public/js/auth.js by hand");
  } else {
    const allowed = (n) => /^\/[A-Za-z0-9]/.test(n) && n.indexOf("//") < 0 && n.indexOf("\\") < 0;
    const mustRefuse = ["//evil.example", "/\\evil.example", "\\\\evil.example", "https://evil.example", "http://evil.example", "javascript:alert(1)", "data:text/html,x", "///evil.example", "/%2f/evil.example", "/ /evil", "", " /account/", "/\t/evil.example", "/a//b", "/a\\b", "//\\evil", "\n//evil.example"];
    const mustAllow = ["/account/", "/admin/", "/buy/", "/thanks/?order=ord_1"];
    const wrong = [...mustRefuse.filter(allowed).map((x) => "allowed " + JSON.stringify(x)), ...mustAllow.filter((x) => !allowed(x)).map((x) => "refused " + JSON.stringify(x))];
    wrong.length ? bad("redirect rule", wrong.join(", ")) : ok(`redirect rule refuses ${mustRefuse.length} hostile targets and allows our own pages`);
  }
} finally {
  await browser.close();
  server.close();
  apiChild.kill();
  fs.rmSync(profile, { recursive: true, force: true });
  fs.rmSync(apiTmp, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(process.exitCode || 0);
