// scripts/test-admin.cjs: admin API (access control, users, purchases, stats, blog publishing). Run: node scripts/test-admin.cjs
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const http = require("http");
const os = require("os");
const path = require("path");
const fs = require("fs");

const ORIGIN = "http://localhost:4321";
const SECRET = "whsec_" + crypto.randomBytes(24).toString("base64");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fg-admin-"));
const blogDir = path.join(tmp, "blog");
const imgDir = path.join(tmp, "img");
fs.mkdirSync(blogDir);

// A tiny stand-in for the GitHub contents API.
const ghFiles = {};
const ghLog = [];
const fakeGithub = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    const m = /^\/repos\/([^/]+\/[^/]+)\/contents\/([^?]+)/.exec(req.url);
    const p = m ? decodeURIComponent(m[2]) : "";
    ghLog.push({ method: req.method, path: p, auth: req.headers.authorization, body: b ? JSON.parse(b) : null });
    if (req.method === "GET") {
      if (ghFiles[p]) {
        if (/raw/.test(String(req.headers.accept))) {
          res.writeHead(200, { "Content-Type": "text/plain" });
          return res.end(ghFiles[p].content);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ sha: ghFiles[p].sha }));
      }
      res.writeHead(404);
      return res.end("{}");
    }
    if (req.method === "DELETE") {
      delete ghFiles[p];
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end("{}");
    }
    const body = JSON.parse(b);
    ghFiles[p] = { sha: crypto.randomBytes(8).toString("hex"), content: Buffer.from(body.content, "base64").toString("utf8") };
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end("{}");
  });
});

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log("  ok  " + name);
  } catch (e) {
    console.error("FAIL  " + name + "\n      " + (e && e.message));
    process.exitCode = 1;
  }
}
function call(base, method, p, { body, headers = {}, raw } = {}) {
  return new Promise((resolve, reject) => {
    const data = raw !== undefined ? raw : body ? JSON.stringify(body) : "";
    const r = http.request(base + p, { method, headers: { ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      let t = "";
      res.on("data", (c) => (t += c));
      res.on("end", () => {
        let json = {};
        try {
          json = JSON.parse(t);
        } catch {
          /* not json */
        }
        resolve({ status: res.statusCode, headers: res.headers, body: json, text: t });
      });
    });
    r.on("error", reject);
    r.end(data);
  });
}

(async () => {
  await new Promise((r) => fakeGithub.listen(0, "127.0.0.1", r));
  Object.assign(process.env, {
    ADMIN_EMAILS: "boss@example.com",
    ALLOWED_ORIGINS: ORIGIN,
    SITE_URL: "https://flowget.net",
    AUTH_DEV_GOOGLE: "1",
    DODO_WEBHOOK_SECRET: SECRET,
    LICENSES_DB: path.join(tmp, "licenses.json"),
    ACCOUNTS_DB: path.join(tmp, "accounts.json"),
    BLOG_DIR: blogDir,
    BLOG_IMG_DIR: imgDir,
    GITHUB_API_BASE: `http://127.0.0.1:${fakeGithub.address().port}`,
  });
  const handler = require("../server/license-server.cjs");
  const api = http.createServer(handler);
  await new Promise((r) => api.listen(0, "127.0.0.1", r));
  const A = `http://127.0.0.1:${api.address().port}`;
  const J = { "Content-Type": "application/json", Origin: ORIGIN };

  async function signUp(email, name) {
    const g = await call(A, "POST", "/api/auth/google", { body: { credential: `dev:${email}|${name}` }, headers: J });
    const done = await call(A, "POST", "/api/auth/complete", { body: { setupToken: g.body.setupToken, name, phone: "+919876543210", password: "Passw0rd123" }, headers: J });
    assert.strictEqual(done.status, 200, done.text);
    return String(done.headers["set-cookie"][0]).split(";")[0];
  }
  const boss = await signUp("boss@example.com", "Boss Person");
  const normal = await signUp("jane@example.com", "Jane Doe");
  const as = (cookie, extra = {}) => ({ headers: { ...J, Cookie: cookie, ...extra } });

  // One real purchase through the signed webhook.
  const payload = { type: "payment.succeeded", data: { payment_id: "pay_admin_1", total_amount: 1999, currency: "USD", customer: { email: "jane@example.com", name: "Jane" }, metadata: {} } };
  const raw = JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.createHmac("sha256", Buffer.from(SECRET.slice(6), "base64")).update(`evt_a1.${ts}.${raw}`).digest("base64");
  await call(A, "POST", "/api/webhook/dodo", { raw, headers: { "Content-Type": "application/json", "webhook-id": "evt_a1", "webhook-timestamp": ts, "webhook-signature": "v1," + sig } });

  console.log("Admin API");

  await test("only admins get in: anonymous 401, normal account 403, admin 200", async () => {
    assert.strictEqual((await call(A, "GET", "/api/admin/stats", { headers: { Origin: ORIGIN } })).status, 401);
    assert.strictEqual((await call(A, "GET", "/api/admin/stats", as(normal))).status, 403);
    assert.strictEqual((await call(A, "GET", "/api/admin/users", as(normal))).status, 403);
    assert.strictEqual((await call(A, "POST", "/api/admin/blog", { ...as(normal), body: {} })).status, 403);
    const me = await call(A, "GET", "/api/admin/me", as(boss));
    assert.strictEqual(me.status, 200);
    assert.strictEqual(me.body.email, "boss@example.com");
    assert.strictEqual((await call(A, "GET", "/api/auth/me", as(boss))).body.isAdmin, true);
    assert.strictEqual((await call(A, "GET", "/api/auth/me", as(normal))).body.isAdmin, false);
  });

  await test("admin POSTs need our website as origin", async () => {
    const r = await call(A, "POST", "/api/admin/license", { headers: { "Content-Type": "application/json", Origin: "https://evil.example", Cookie: boss }, body: { keyId: "x" } });
    assert.strictEqual(r.status, 403);
  });

  await test("users list: both accounts, searchable, never exposes passwords", async () => {
    const r = await call(A, "GET", "/api/admin/users", as(boss));
    assert.strictEqual(r.body.total, 2);
    assert(!r.text.includes("passwordHash"));
    const jane = r.body.rows.find((u) => u.email === "jane@example.com");
    assert.strictEqual(jane.purchases, 1);
    assert.strictEqual(jane.phone, "+919876543210");
    assert.strictEqual((await call(A, "GET", "/api/admin/users?q=doe", as(boss))).body.total, 1);
    assert.strictEqual((await call(A, "GET", "/api/admin/users?q=nobody", as(boss))).body.total, 0);
  });

  await test("purchases and stats reflect the payment", async () => {
    const p = (await call(A, "GET", "/api/admin/purchases", as(boss))).body;
    assert.strictEqual(p.rows.length, 1);
    assert.strictEqual(p.rows[0].amount, 1999);
    assert.strictEqual(p.rows[0].currency, "USD");
    assert.strictEqual(p.rows[0].status, "paid");
    const s = (await call(A, "GET", "/api/admin/stats", as(boss))).body;
    assert.strictEqual(s.users.total, 2);
    assert.strictEqual(s.users.perDay.length, 30);
    assert.strictEqual(s.users.perDay[29].n, 2);
    assert.strictEqual(s.sales.purchases, 1);
    assert.strictEqual(s.sales.revenue.USD, 1999);
    assert.strictEqual(s.sales.perDay[29].n, 1);
    assert.strictEqual(s.licenses.issued, 1);
    assert.strictEqual(s.licenses.neverActivated, 1);
  });

  await test("revoking and restoring a license changes status and revenue", async () => {
    const keyId = (await call(A, "GET", "/api/admin/purchases", as(boss))).body.rows[0].keyId;
    assert.strictEqual((await call(A, "POST", "/api/admin/license", { ...as(boss), body: { keyId, revoked: true } })).status, 200);
    assert.strictEqual((await call(A, "GET", "/api/admin/purchases", as(boss))).body.rows[0].status, "refunded");
    assert.strictEqual((await call(A, "GET", "/api/admin/stats", as(boss))).body.sales.revenue.USD, undefined);
    await call(A, "POST", "/api/admin/license", { ...as(boss), body: { keyId, revoked: false } });
    assert.strictEqual((await call(A, "GET", "/api/admin/purchases", as(boss))).body.rows[0].status, "paid");
    assert.strictEqual((await call(A, "POST", "/api/admin/license", { ...as(boss), body: { keyId: "nope" } })).status, 404);
  });

  const post = {
    title: "How to speed up large downloads on Windows",
    description: "A practical guide to getting the most from your connection when you download large files, with simple checks and fixes.",
    tags: ["Speed", "windows"],
    body: "Intro paragraph. ".repeat(20) + "\n\n## Step one\n\nDo this first.\n",
    faq: [{ q: "Does it work?", a: "Yes, \"quoted\" answer: with a colon." }],
    coverAlt: "Speedometer",
  };
  // 1x1 PNG
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

  await test("blog: validates input before writing anything", async () => {
    assert.strictEqual((await call(A, "POST", "/api/admin/blog", { ...as(boss), body: { ...post, title: "Short" } })).status, 400);
    assert.strictEqual((await call(A, "POST", "/api/admin/blog", { ...as(boss), body: { ...post, description: "too short" } })).status, 400);
    assert.strictEqual((await call(A, "POST", "/api/admin/blog", { ...as(boss), body: { ...post, body: "tiny" } })).status, 400);
    assert.strictEqual((await call(A, "POST", "/api/admin/blog", { ...as(boss), body: { ...post, coverImage: "data:image/png;base64,AAAA" } })).status, 400);
    assert.deepStrictEqual(fs.readdirSync(blogDir), []);
  });

  await test("blog: local publish writes a valid Markdown file and cover image", async () => {
    const r = await call(A, "POST", "/api/admin/blog", { ...as(boss), body: { ...post, coverImage: PNG } });
    assert.strictEqual(r.status, 200, r.text);
    assert.strictEqual(r.body.slug, "how-to-speed-up-large-downloads-on-windows");
    assert.strictEqual(r.body.mode, "local");
    assert.strictEqual(r.body.url, "https://flowget.net/blog/how-to-speed-up-large-downloads-on-windows/");
    const md = fs.readFileSync(path.join(blogDir, r.body.slug + ".md"), "utf8");
    assert(md.startsWith('---\ntitle: "How to speed up large downloads on Windows"\n'));
    assert(md.includes('tags: ["speed","windows"]'));
    assert(md.includes(`cover: "/img/blog/${r.body.slug}.png"`));
    assert(md.includes('a: "Yes, \\"quoted\\" answer: with a colon."'));
    assert(/pubDate: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\n/.test(md));
    assert(md.includes("## Step one"));
    assert(fs.existsSync(path.join(imgDir, r.body.slug + ".png")));
  });

  await test("blog: an existing slug is not overwritten unless asked", async () => {
    assert.strictEqual((await call(A, "POST", "/api/admin/blog", { ...as(boss), body: post })).status, 409);
    assert.strictEqual((await call(A, "POST", "/api/admin/blog", { ...as(boss), body: { ...post, overwrite: true, draft: true } })).status, 200);
    assert(fs.readFileSync(path.join(blogDir, "how-to-speed-up-large-downloads-on-windows.md"), "utf8").includes("draft: true"));
  });

  await test("blog: odd slugs cannot escape the blog folder", async () => {
    const r = await call(A, "POST", "/api/admin/blog", { ...as(boss), body: { ...post, slug: "../../evil/name" } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.slug, "evil-name");
    assert.deepStrictEqual(fs.readdirSync(blogDir).sort(), ["evil-name.md", "how-to-speed-up-large-downloads-on-windows.md"]);
    assert.strictEqual((await call(A, "POST", "/api/admin/blog", { ...as(boss), body: { ...post, slug: "!!" } })).status, 400);
  });

  await test("blog list shows the posts", async () => {
    const r = await call(A, "GET", "/api/admin/blog", as(boss));
    assert.strictEqual(r.body.publishing, "local");
    const titles = r.body.posts.map((p) => p.title);
    assert(titles.includes("How to speed up large downloads on Windows"));
  });

  await test("blog: with GitHub configured the post is committed to the repo", async () => {
    Object.assign(process.env, { GITHUB_TOKEN: "ghp_test", GITHUB_REPO: "acme/flowget", GITHUB_BRANCH: "main" });
    const r = await call(A, "POST", "/api/admin/blog", { ...as(boss), body: { ...post, slug: "github-post-test", coverImage: PNG } });
    assert.strictEqual(r.status, 200, r.text);
    assert.strictEqual(r.body.mode, "github");
    const put = ghLog.filter((l) => l.method === "PUT");
    assert.strictEqual(put.length, 2);
    assert(put.every((l) => l.auth === "Bearer ghp_test"));
    assert(ghFiles["website/src/content/blog/github-post-test.md"].content.includes('title: "How to speed up'));
    assert(ghFiles["website/public/img/blog/github-post-test.png"]);
    assert.strictEqual((await call(A, "POST", "/api/admin/blog", { ...as(boss), body: { ...post, slug: "github-post-test" } })).status, 409);
    assert.strictEqual((await call(A, "POST", "/api/admin/blog", { ...as(boss), body: { ...post, slug: "github-post-test", overwrite: true } })).status, 200);
    assert(ghLog.some((l) => l.method === "PUT" && l.body && l.body.sha), "an update sends the previous sha");
  });

  await test("editor: an existing post can be loaded, edited and saved back", async () => {
    Object.assign(process.env, { GITHUB_TOKEN: "", GITHUB_REPO: "" }); // back to local mode
    const slug = "how-to-speed-up-large-downloads-on-windows";
    const r = await call(A, "GET", "/api/admin/blog/post?slug=" + slug, as(boss));
    assert.strictEqual(r.status, 200, r.text);
    assert.strictEqual(r.body.title, post.title);
    assert.deepStrictEqual(r.body.tags, ["speed", "windows"]);
    assert.strictEqual(r.body.faq.length, 1);
    assert.strictEqual(r.body.faq[0].a, 'Yes, "quoted" answer: with a colon.');
    assert.strictEqual(r.body.draft, true);
    assert(r.body.body.includes("## Step one"));
    assert.strictEqual((await call(A, "GET", "/api/admin/blog/post?slug=nope-nope", as(boss))).status, 404);
    assert.strictEqual((await call(A, "GET", "/api/admin/blog/post?slug=../etc", as(boss))).status, 400);
    assert.strictEqual((await call(A, "GET", "/api/admin/blog/post?slug=" + slug, as(normal))).status, 403);

    const save = await call(A, "POST", "/api/admin/blog", { ...as(boss), body: { ...r.body, editing: true, draft: false, body: r.body.body + "\n\n## Added later\n\nMore words.\n", cover: r.body.cover } });
    assert.strictEqual(save.status, 200, save.text);
    const md = fs.readFileSync(path.join(blogDir, slug + ".md"), "utf8");
    assert(md.includes("## Added later"));
    assert(!md.includes("draft: true"));
    assert(md.includes("pubDate: " + r.body.pubDate), "the original publish date is kept");
    assert(/updatedDate: \d{4}-/.test(md), "an update stamps updatedDate");
  });

  await test("editor: the page title is the only H1 (a leading # becomes ##, code blocks untouched)", async () => {
    const body = "# Big heading\n\n" + "Words go here. ".repeat(20) + "\n\n```sh\n# a comment, not a heading\n```\n";
    const r = await call(A, "POST", "/api/admin/blog", { ...as(boss), body: { ...post, slug: "h1-test-post", body } });
    assert.strictEqual(r.status, 200, r.text);
    const md = fs.readFileSync(path.join(blogDir, "h1-test-post.md"), "utf8");
    assert(md.includes("\n## Big heading\n"));
    assert(md.includes("# a comment, not a heading"));
    assert(!/\n# Big heading/.test(md));
  });

  await test("editor: pictures inside an article upload, with type and size checks", async () => {
    const ok = await call(A, "POST", "/api/admin/blog/image", { ...as(boss), body: { dataUrl: PNG } });
    assert.strictEqual(ok.status, 200, ok.text);
    assert(/^\/img\/blog\/post-[0-9a-f]{10}\.png$/.test(ok.body.url));
    assert(fs.existsSync(path.join(imgDir, path.basename(ok.body.url))));
    assert.strictEqual((await call(A, "POST", "/api/admin/blog/image", { ...as(boss), body: { dataUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" } })).status, 400);
    assert.strictEqual((await call(A, "POST", "/api/admin/blog/image", { ...as(boss), body: { dataUrl: "data:image/png;base64," + Buffer.from("not a png at all really").toString("base64") } })).status, 400);
    assert.strictEqual((await call(A, "POST", "/api/admin/blog/image", { ...as(normal), body: { dataUrl: PNG } })).status, 403);
  });

  await test("editor: a post can be deleted (and only once)", async () => {
    assert.strictEqual((await call(A, "POST", "/api/admin/blog/delete", { ...as(normal), body: { slug: "h1-test-post" } })).status, 403);
    assert.strictEqual((await call(A, "POST", "/api/admin/blog/delete", { ...as(boss), body: { slug: "h1-test-post" } })).status, 200);
    assert(!fs.existsSync(path.join(blogDir, "h1-test-post.md")));
    assert.strictEqual((await call(A, "POST", "/api/admin/blog/delete", { ...as(boss), body: { slug: "h1-test-post" } })).status, 404);
    assert.strictEqual((await call(A, "POST", "/api/admin/blog/delete", { ...as(boss), body: { slug: "../x" } })).status, 400);
  });

  await test("editor: GitHub mode reads and deletes through the API too", async () => {
    Object.assign(process.env, { GITHUB_TOKEN: "ghp_test", GITHUB_REPO: "acme/flowget", GITHUB_BRANCH: "main" });
    const rel = "website/src/content/blog/github-post-test.md";
    const got = await call(A, "GET", "/api/admin/blog/post?slug=github-post-test", as(boss));
    assert.strictEqual(got.status, 200, got.text);
    assert.strictEqual(got.body.title, post.title);
    const del = await call(A, "POST", "/api/admin/blog/delete", { ...as(boss), body: { slug: "github-post-test" } });
    assert.strictEqual(del.status, 200, del.text);
    assert(ghLog.some((l) => l.method === "DELETE" && l.path === rel && l.body && l.body.sha), "sends DELETE with the file sha");
    Object.assign(process.env, { GITHUB_TOKEN: "", GITHUB_REPO: "" });
  });

  await test("stats: period length, comparison data and activity feed", async () => {
    const s7 = (await call(A, "GET", "/api/admin/stats?days=7", as(boss))).body;
    assert.strictEqual(s7.range.days, 7);
    assert.strictEqual(s7.series.days.length, 7);
    assert.strictEqual(s7.series.users.length, 7);
    assert.strictEqual((await call(A, "GET", "/api/admin/stats?days=12", as(boss))).body.range.days, 30, "unknown periods fall back to 30");
    const s90 = (await call(A, "GET", "/api/admin/stats?days=90", as(boss))).body;
    assert.strictEqual(s90.series.days.length, 90);
    assert.strictEqual(s90.compare.purchases.now, 1);
    assert.strictEqual(s90.compare.purchases.prev, 0);
    assert.strictEqual(s90.range.currency, "USD");
    assert.strictEqual(s90.series.revenue.reduce((a, b) => a + b, 0), 19.99);
    assert.strictEqual(s90.funnel.signups, 2);
    assert(s90.activity.length >= 3 && s90.activity.some((a) => a.type === "purchase"));
  });

  await test("demo data: only for local testing, can be loaded and fully removed", async () => {
    const me = (await call(A, "GET", "/api/admin/me", as(boss))).body;
    assert.strictEqual(me.demoTools, true);
    assert.strictEqual((await call(A, "POST", "/api/admin/demo", { ...as(normal), body: { action: "seed" } })).status, 403);
    const before = (await call(A, "GET", "/api/admin/stats", as(boss))).body;
    assert.strictEqual((await call(A, "POST", "/api/admin/demo", { ...as(boss), body: { action: "seed" } })).status, 200);
    const mid = (await call(A, "GET", "/api/admin/stats?days=90", as(boss))).body;
    assert(mid.users.total > before.users.total + 50);
    assert(mid.sales.purchases > 5);
    assert.strictEqual((await call(A, "POST", "/api/admin/demo", { ...as(boss), body: { action: "clear" } })).status, 200);
    const after = (await call(A, "GET", "/api/admin/stats", as(boss))).body;
    assert.strictEqual(after.users.total, before.users.total);
    assert.strictEqual(after.sales.purchases, before.sales.purchases);
    assert.strictEqual(after.licenses.issued, before.licenses.issued);
  });

  console.log(`\n${passed} passed`);
  api.close();
  fakeGithub.close();
  fs.rmSync(tmp, { recursive: true, force: true });
})();
