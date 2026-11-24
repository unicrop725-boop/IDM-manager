// server/admin.cjs
// Admin panel API: users, purchases, stats and publishing blog posts. Zero dependencies.
//
// Only signed-in accounts whose email is in ADMIN_EMAILS can use it (same sign-in as everyone else: Google first, then email + password).
//
// Routes (JSON, cookie session):
//   GET  /api/admin/me                 who am I (403 when not an admin)
//   GET  /api/admin/stats?days=7|30|90 numbers, period comparison and daily series for the dashboard
//   GET  /api/admin/users?q=&page=&all=1
//   GET  /api/admin/purchases
//   POST /api/admin/license            { keyId, revoked }   revoke or restore a license
//   GET  /api/admin/blog               existing posts
//   POST /api/admin/blog               publish or update a post (Markdown file + optional cover image)
//   GET  /api/admin/blog/post?slug=    one post as editable fields (for the editor)
//   POST /api/admin/blog/delete        { slug }
//   POST /api/admin/blog/image         { dataUrl }  upload a picture used inside an article -> { url }
//   GET  /api/admin/reviews            all reviews (pending first)
//   POST /api/admin/reviews            { id, action: "approve" | "reject" | "delete" }
//   POST /api/admin/demo               { action: "seed" | "clear" }  fake data for local testing (only with AUTH_DEV_GOOGLE=1)
//
// Blog publishing target (the website is static, so a post is a Markdown file in the repository):
//   GITHUB_TOKEN + GITHUB_REPO (owner/name)   commit through the GitHub API; Cloudflare Pages then rebuilds the site
//     GITHUB_BRANCH (default main), GITHUB_SITE_DIR (default website)
//   otherwise, when ../website exists next to this folder, the file is written there (local use)
//   BLOG_DIR / BLOG_IMG_DIR override the local folders

"use strict";

const fs = require("fs");
const path = require("path");

const GITHUB_API = process.env.GITHUB_API_BASE || "https://api.github.com"; // GITHUB_API_BASE: tests only
const MAX_BODY = 4 * 1024 * 1024;
const MAX_IMAGE = 2.5 * 1024 * 1024;
const DAY = 86400000;
// Demo data tools exist only when the fake Google login is on (local testing).
const DEV = process.env.AUTH_DEV_GOOGLE === "1";

const clean = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}
const validSlug = (s) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) && s.length >= 3 && s.length <= 80;

/** Reads the title / date / draft flag out of a post's front matter. */
function frontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('"')) {
      try {
        v = JSON.parse(v);
      } catch {
        v = v.replace(/^"|"$/g, "");
      }
    }
    out[kv[1]] = v;
  }
  return out;
}

/** The page title is the only H1, so "# Heading" in the article becomes "## Heading" (code blocks are left alone). */
function demoteH1(text) {
  let fence = false;
  return text
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fence = !fence;
      return !fence && /^# +\S/.test(line) ? "#" + line : line;
    })
    .join("\n");
}

/** Reads a post file back into editable fields. Returns null for layouts it cannot read safely (e.g. multi-line YAML strings). */
function parsePostFile(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const val = (raw) => {
    const v = raw.trim();
    if (v.startsWith('"')) {
      try {
        return JSON.parse(v);
      } catch {
        return v.replace(/^"|"$/g, "");
      }
    }
    if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) return v.slice(1, -1).replace(/''/g, "'");
    return v;
  };
  const out = { title: "", description: "", pubDate: "", author: "", tags: [], cover: "", coverAlt: "", draft: false, featured: false, faq: [], body: m[2].replace(/^\n+/, "") };
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (/^faq:\s*$/.test(line)) {
      let cur = null;
      while (i + 1 < lines.length && /^(\s|-)/.test(lines[i + 1])) {
        const l = lines[++i];
        const q = /^\s*-\s*q:\s*(.*)$/.exec(l);
        const a = /^\s*(?:-\s*)?a:\s*(.*)$/.exec(l);
        if (q) {
          cur = { q: val(q[1]), a: "" };
          out.faq.push(cur);
        } else if (a && cur) cur.a = val(a[1]);
      }
      continue;
    }
    const kv = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!kv) return null;
    const [, key, rest] = kv;
    if (/^[>|][+-]?$/.test(rest.trim())) return null; // multi-line scalar
    if (key === "tags") {
      let t = rest.trim();
      try {
        out.tags = JSON.parse(t.replace(/'/g, '"'));
      } catch {
        out.tags = t.replace(/^\[|\]$/g, "").split(",").map((x) => val(x)).filter(Boolean);
      }
    } else if (key === "draft" || key === "featured") out[key] = rest.trim() === "true";
    else if (["title", "description", "author", "cover", "coverAlt"].includes(key)) out[key] = val(rest);
    else if (key === "pubDate") out.pubDate = val(rest);
  }
  return out.title ? out : null;
}

/** The Markdown file for a post. Strings are written as JSON, which is valid (and safely quoted) YAML. */
function buildMarkdown(p) {
  const L = ["---"];
  L.push(`title: ${JSON.stringify(p.title)}`);
  L.push(`description: ${JSON.stringify(p.description)}`);
  L.push(`pubDate: ${p.pubDate}`);
  if (p.updatedDate) L.push(`updatedDate: ${p.updatedDate}`);
  if (p.author) L.push(`author: ${JSON.stringify(p.author)}`);
  L.push(`tags: ${JSON.stringify(p.tags)}`);
  if (p.cover) L.push(`cover: ${JSON.stringify(p.cover)}`);
  if (p.coverAlt) L.push(`coverAlt: ${JSON.stringify(p.coverAlt)}`);
  if (p.draft) L.push("draft: true");
  if (p.featured) L.push("featured: true");
  if (p.faq.length) {
    L.push("faq:");
    for (const f of p.faq) {
      L.push(`  - q: ${JSON.stringify(f.q)}`);
      L.push(`    a: ${JSON.stringify(f.a)}`);
    }
  }
  L.push("---", "", p.body.replace(/\r\n/g, "\n").trim(), "");
  return L.join("\n");
}

/** png / jpeg / webp from a data URL, checked by its first bytes (not by what the browser claims). */
function decodeImage(dataUrl) {
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) return null;
  const buf = Buffer.from(m[2], "base64");
  if (buf.length < 12 || buf.length > MAX_IMAGE) return null;
  let ext = "";
  if (buf[0] === 0x89 && buf.toString("latin1", 1, 4) === "PNG") ext = "png";
  else if (buf[0] === 0xff && buf[1] === 0xd8) ext = "jpg";
  else if (buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") ext = "webp";
  return ext ? { buf, ext } : null;
}

/**
 * @param {{
 *   db: any, saveDb: () => void, auth: any, siteUrl: () => string, issueLicense: (o: any) => string,
 *   limited: (k: string, max: number, ms: number) => boolean, clientIp: (req: any) => string,
 * }} ctx
 */
function createHandler(ctx) {
  const { db, saveDb, auth, limited, clientIp } = ctx;
  const { Problem, send } = auth;

  /* ---------------- blog publishing target ---------------- */
  const gh = () => ({
    token: process.env.GITHUB_TOKEN || "",
    repo: process.env.GITHUB_REPO || "",
    branch: process.env.GITHUB_BRANCH || "main",
    dir: (process.env.GITHUB_SITE_DIR === undefined ? "website" : process.env.GITHUB_SITE_DIR).replace(/^\/+|\/+$/g, ""),
  });
  const localBlogDir = () => process.env.BLOG_DIR || path.join(__dirname, "..", "website", "src", "content", "blog");
  const localImgDir = () => process.env.BLOG_IMG_DIR || path.join(__dirname, "..", "website", "public", "img", "blog");
  function mode() {
    const g = gh();
    if (g.token && g.repo) return "github";
    if (fs.existsSync(localBlogDir())) return "local";
    return "none";
  }
  const repoPath = (g, rel) => (g.dir ? g.dir + "/" : "") + rel;

  async function ghFetch(g, method, apiPath, body, accept) {
    const res = await fetch(GITHUB_API + apiPath, {
      method,
      headers: {
        Authorization: "Bearer " + g.token,
        Accept: accept || "application/vnd.github+json",
        "User-Agent": "flowget-admin",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    return res;
  }
  const enc = (p) => p.split("/").map(encodeURIComponent).join("/");

  async function ghExists(g, rel) {
    const r = await ghFetch(g, "GET", `/repos/${g.repo}/contents/${enc(repoPath(g, rel))}?ref=${encodeURIComponent(g.branch)}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Problem(502, "GitHub refused the request (" + r.status + "). Check GITHUB_TOKEN and GITHUB_REPO.");
    const j = await r.json();
    return { sha: j.sha };
  }

  /** Writes one file to the site. `overwrite=false` refuses to replace an existing file. */
  async function putFile(rel, buffer, message, overwrite) {
    const m = mode();
    if (m === "github") {
      const g = gh();
      const found = await ghExists(g, rel).catch((e) => {
        if (e instanceof Problem) throw e;
        throw new Problem(502, "Could not reach GitHub.");
      });
      if (found && !overwrite) throw new Problem(409, "A file with that name already exists.");
      const r = await ghFetch(g, "PUT", `/repos/${g.repo}/contents/${enc(repoPath(g, rel))}`, {
        message,
        content: buffer.toString("base64"),
        branch: g.branch,
        ...(found ? { sha: found.sha } : {}),
      });
      if (!r.ok) {
        console.error("[admin] GitHub write failed:", r.status, (await r.text()).slice(0, 300));
        throw new Problem(502, "GitHub did not accept the post (" + r.status + "). The token needs Contents: read and write.");
      }
      return "github";
    }
    if (m === "local") {
      const target = rel.startsWith("src/content/blog/") ? path.join(localBlogDir(), path.basename(rel)) : path.join(localImgDir(), path.basename(rel));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (fs.existsSync(target) && !overwrite) throw new Problem(409, "A file with that name already exists.");
      fs.writeFileSync(target, buffer);
      return "local";
    }
    throw new Problem(503, "Publishing is not set up. Set GITHUB_TOKEN and GITHUB_REPO on the server (see README, Admin panel).");
  }

  /** Raw text of one post file. */
  async function readPostFile(slug) {
    const m = mode();
    if (m === "local") {
      for (const ext of [".md", ".mdx"]) {
        const f = path.join(localBlogDir(), slug + ext);
        if (fs.existsSync(f)) return fs.readFileSync(f, "utf8");
      }
      return null;
    }
    if (m === "github") {
      const g = gh();
      const r = await ghFetch(g, "GET", `/repos/${g.repo}/contents/${enc(repoPath(g, `src/content/blog/${slug}.md`))}?ref=${encodeURIComponent(g.branch)}`, null, "application/vnd.github.raw+json");
      if (r.status === 404) return null;
      if (!r.ok) throw new Problem(502, "Could not read the post from GitHub (" + r.status + ").");
      return await r.text();
    }
    throw new Problem(503, "Publishing is not set up.");
  }

  async function deletePostFile(slug) {
    const m = mode();
    if (m === "local") {
      let done = false;
      for (const ext of [".md", ".mdx"]) {
        const f = path.join(localBlogDir(), slug + ext);
        if (fs.existsSync(f)) {
          fs.unlinkSync(f);
          done = true;
        }
      }
      if (!done) throw new Problem(404, "Post not found.");
      return "local";
    }
    if (m === "github") {
      const g = gh();
      const rel = `src/content/blog/${slug}.md`;
      const found = await ghExists(g, rel);
      if (!found) throw new Problem(404, "Post not found.");
      const r = await ghFetch(g, "DELETE", `/repos/${g.repo}/contents/${enc(repoPath(g, rel))}`, { message: `Blog: delete ${slug}`, sha: found.sha, branch: g.branch });
      if (!r.ok) throw new Problem(502, "GitHub did not delete the post (" + r.status + ").");
      return "github";
    }
    throw new Problem(503, "Publishing is not set up.");
  }

  let listCache = { at: 0, mode: "", posts: [] };
  async function listPosts() {
    const m = mode();
    if (listCache.mode === m && Date.now() - listCache.at < 30000) return listCache.posts;
    let posts = [];
    if (m === "local") {
      for (const f of fs.readdirSync(localBlogDir())) {
        if (!/\.mdx?$/.test(f)) continue;
        const fm = frontMatter(fs.readFileSync(path.join(localBlogDir(), f), "utf8"));
        posts.push({ slug: f.replace(/\.mdx?$/, ""), title: fm.title || f, pubDate: fm.pubDate || "", draft: fm.draft === "true" });
      }
    } else if (m === "github") {
      const g = gh();
      const r = await ghFetch(g, "GET", `/repos/${g.repo}/contents/${enc(repoPath(g, "src/content/blog"))}?ref=${encodeURIComponent(g.branch)}`);
      if (!r.ok) throw new Problem(502, "Could not list posts on GitHub (" + r.status + ").");
      const files = (await r.json()).filter((f) => f.type === "file" && /\.mdx?$/.test(f.name)).slice(0, 200);
      posts = await Promise.all(
        files.map(async (f) => {
          let fm = {};
          try {
            const raw = await ghFetch(g, "GET", `/repos/${g.repo}/contents/${enc(f.path)}?ref=${encodeURIComponent(g.branch)}`, null, "application/vnd.github.raw+json");
            if (raw.ok) fm = frontMatter(await raw.text());
          } catch {
            /* show the file name only */
          }
          return { slug: f.name.replace(/\.mdx?$/, ""), title: fm.title || f.name, pubDate: fm.pubDate || "", draft: fm.draft === "true" };
        }),
      );
    }
    posts.sort((a, b) => String(b.pubDate).localeCompare(String(a.pubDate)));
    listCache = { at: Date.now(), mode: m, posts };
    return posts;
  }

  /* ---------------- data views ---------------- */
  const licensesByEmail = () => {
    const map = new Map();
    for (const l of Object.values(db.licenses)) {
      for (const e of new Set([String(l.email || "").toLowerCase(), String(l.accountEmail || "").toLowerCase()])) {
        if (!e) continue;
        map.set(e, (map.get(e) || 0) + 1);
      }
    }
    return map;
  };

  function dayKey(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }
  function series(timestamps, days) {
    const today = Date.now();
    const keys = [];
    for (let i = days - 1; i >= 0; i--) keys.push(dayKey(today - i * DAY));
    const counts = Object.fromEntries(keys.map((k) => [k, 0]));
    for (const t of timestamps) {
      const k = dayKey(t);
      if (k in counts) counts[k]++;
    }
    return keys.map((d) => ({ d, n: counts[d] }));
  }

  const RANGES = [7, 30, 90];

  /** Dashboard numbers. `days` = length of the period shown (7, 30 or 90); the period before it is used for the "vs previous" comparison. */
  function stats(days) {
    days = RANGES.includes(days) ? days : 30;
    const now = Date.now();
    const users = auth.listUsers();
    const payments = Object.entries(db.payments || {}).map(([id, p]) => ({ id, ...p, revoked: !!(db.licenses[p.licenseKey] && db.licenses[p.licenseKey].revoked) }));
    const live = payments.filter((p) => !p.revoked);
    const sumBy = (list) => {
      const m = {};
      for (const p of list) {
        const c = p.currency || "USD";
        m[c] = (m[c] || 0) + (p.amount || 0);
      }
      return m;
    };
    const revenue = sumBy(live);
    // The revenue chart is drawn in one currency (amounts in different currencies cannot be added up):
    // the one with the most purchases. Other currencies still show in the all-time totals.
    const countBy = {};
    for (const p of live) countBy[p.currency || "USD"] = (countBy[p.currency || "USD"] || 0) + 1;
    const cur = Object.keys(countBy).sort((x, y) => countBy[y] - countBy[x])[0] || "USD";
    const inWindow = (t, from, to) => t >= from && t < to;
    const cutNow = now - days * DAY;
    const cutPrev = now - 2 * days * DAY;
    const orders = Object.values(db.orders || {});
    const conv = (from, to) => {
      const started = orders.filter((o) => inWindow(o.createdAt, from, to)).length;
      const paid = orders.filter((o) => inWindow(o.createdAt, from, to) && o.status === "paid").length;
      return { started, paid, pct: started ? Math.round((paid / started) * 1000) / 10 : 0 };
    };
    const curPay = live.filter((p) => inWindow(p.at, cutNow, now + 1));
    const prevPay = live.filter((p) => inWindow(p.at, cutPrev, cutNow));
    const revIn = (list) => list.filter((p) => (p.currency || "USD") === cur).reduce((n, p) => n + (p.amount || 0), 0);

    // Per-day series for the shown period (oldest first).
    const keys = [];
    for (let i = days - 1; i >= 0; i--) keys.push(dayKey(now - i * DAY));
    const zero = () => Object.fromEntries(keys.map((k) => [k, 0]));
    const uDay = zero();
    const pDay = zero();
    const rDay = zero();
    for (const u of users) if (u.createdAt && dayKey(u.createdAt) in uDay) uDay[dayKey(u.createdAt)]++;
    for (const p of live) {
      const k = dayKey(p.at);
      if (k in pDay) {
        pDay[k]++;
        if ((p.currency || "USD") === cur) rDay[k] += (p.amount || 0) / 100;
      }
    }

    const licenses = Object.values(db.licenses);
    const activations = Object.values(db.activations || {});
    const by = licensesByEmail();
    const bought = users.filter((u) => by.has(u.email)).length;

    // Latest sign-ups and purchases, mixed.
    const activity = [
      ...users.map((u) => ({ type: "user", at: u.createdAt, title: u.name || u.email, sub: u.name ? u.email : "New sign-up", demo: !!u.demo })),
      ...payments.map((p) => ({ type: "purchase", at: p.at, title: p.email || "Purchase", sub: p.revoked ? "Refunded" : "Bought FlowGet Pro", amount: p.amount || 0, currency: p.currency || "USD", demo: !!p.demo })),
    ]
      .sort((x, y) => y.at - x.at)
      .slice(0, 12);

    return {
      generatedAt: now,
      range: { days, currency: cur, mixedCurrencies: Object.keys(countBy).length > 1 },
      compare: {
        revenue: { now: revIn(curPay) / 100, prev: revIn(prevPay) / 100 },
        purchases: { now: curPay.length, prev: prevPay.length },
        users: { now: users.filter((u) => inWindow(u.createdAt, cutNow, now + 1)).length, prev: users.filter((u) => inWindow(u.createdAt, cutPrev, cutNow)).length },
        conversion: { now: conv(cutNow, now + 1), prev: conv(cutPrev, cutNow) },
      },
      series: { days: keys, users: keys.map((k) => uDay[k]), purchases: keys.map((k) => pDay[k]), revenue: keys.map((k) => Math.round(rDay[k] * 100) / 100) },
      funnel: { signups: users.length, completed: users.filter((u) => u.profileComplete).length, bought },
      activity,
      users: {
        total: users.length,
        completed: users.filter((u) => u.profileComplete).length,
        last7: users.filter((u) => now - u.createdAt < 7 * DAY).length,
        last30: users.filter((u) => now - u.createdAt < 30 * DAY).length,
        withPurchase: bought,
        perDay: keys.map((k) => ({ d: k, n: uDay[k] })),
      },
      sales: {
        purchases: payments.length,
        refunded: payments.filter((p) => p.revoked).length,
        revenue,
        revenue30: sumBy(live.filter((p) => now - p.at < 30 * DAY)),
        revenue7: sumBy(live.filter((p) => now - p.at < 7 * DAY)),
        checkoutsStarted: orders.length,
        checkoutsPaid: orders.filter((o) => o.status === "paid").length,
        conversionPct: orders.length ? Math.round((orders.filter((o) => o.status === "paid").length / orders.length) * 1000) / 10 : 0,
        perDay: keys.map((k) => ({ d: k, n: pDay[k] })),
      },
      licenses: {
        issued: licenses.length,
        revoked: licenses.filter((l) => l.revoked).length,
        activeDevices: activations.reduce((n, a) => n + a.length, 0),
        activated: Object.keys(db.licenses).filter((k) => !db.licenses[k].revoked && (db.activations[k] || []).length).length,
        neverActivated: Object.keys(db.licenses).filter((k) => !(db.activations[k] || []).length && !db.licenses[k].revoked).length,
      },
    };
  }

  /* ---------------- demo data (local testing only) ---------------- */
  const DEMO_FIRST = ["Aarav", "Maya", "Liam", "Sofia", "Noah", "Isha", "Ethan", "Zara", "Lucas", "Anaya", "Oliver", "Priya", "Mateo", "Emma", "Kabir", "Chloe", "Arjun", "Mia", "Daniel", "Riya"];
  const DEMO_LAST = ["Sharma", "Patel", "Smith", "Garcia", "Khan", "Chen", "Brown", "Singh", "Muller", "Rossi", "Kumar", "Silva", "Nguyen", "Wilson", "Gupta"];
  function seedDemo() {
    if (db.demoSeeded) return 0;
    const now = Date.now();
    const rnd = (n) => Math.floor(Math.random() * n);
    const specs = [];
    for (let i = 0; i < 64; i++) {
      // More sign-ups recently than long ago, so the charts have a shape.
      const age = Math.pow(Math.random(), 1.6) * 88 * DAY + rnd(DAY);
      const first = DEMO_FIRST[rnd(DEMO_FIRST.length)];
      const last = DEMO_LAST[rnd(DEMO_LAST.length)];
      specs.push({ name: `${first} ${last}`, email: `${first}.${last}${i}@demo.example`.toLowerCase(), createdAt: now - age, buy: Math.random() < 0.42 });
    }
    specs.sort((x, y) => x.createdAt - y.createdAt);
    auth.seedDemoUsers(specs.map((x) => ({ name: x.name, email: x.email, createdAt: x.createdAt, phone: "+9198" + String(10000000 + rnd(89999999)) })));
    let n = 0;
    for (const x of specs) {
      if (!x.buy) {
        if (Math.random() < 0.3) {
          n++;
          db.orders["demo_" + n] = { orderId: "demo_" + n, email: x.email, name: x.name, status: "created", createdAt: x.createdAt + rnd(DAY), demo: true };
        }
        continue;
      }
      const at = Math.min(now - 60000, x.createdAt + rnd(5 * DAY) + 3600000);
      const inr = Math.random() < 0.15;
      n++;
      const paymentId = "pay_demo_" + n;
      const orderId = "demo_" + n;
      const key = ctx.issueLicense({ email: x.email, paymentId, accountEmail: x.email });
      const lic = db.licenses[key];
      lic.issuedAt = at;
      lic.demo = true;
      db.activations[key] = Math.random() < 0.72 ? Array.from({ length: 1 + rnd(2) }, (_, i) => ({ machineId: `demo-${n}-${i}`, machineName: "Windows PC", activatedAt: at + (i + 1) * 3600000 })) : [];
      if (Math.random() < 0.05) lic.revoked = true;
      db.payments[paymentId] = { licenseKey: key, orderId, at, email: x.email, amount: inr ? 99900 : 1999, currency: inr ? "INR" : "USD", demo: true };
      db.orders[orderId] = { orderId, email: x.email, name: x.name, status: "paid", createdAt: at - 120000, paidAt: at, paymentId, licenseKey: key, demo: true };
    }
    const TEXTS = [
      ["Resumed a 9 GB download after my Wi-Fi dropped, without starting over. Exactly what I bought it for.", "Video editor", 5],
      ["The speed limit by time of day is great: full speed at night, quiet during work hours.", "IT administrator", 5],
      ["Much faster than my browser for large files. The browser button on videos is handy too.", "Student", 4],
      ["Simple, fast and it does not nag me. One payment and done.", "Freelance designer", 5],
      ["Warned me about a file with a double extension before I opened it. That alone was worth it.", "Accountant", 5],
      ["Works well on slow connections because it picks up where it stopped. Wish it had a dark theme for the browser extension.", "Teacher", 4],
    ];
    const buyers = Object.values(db.orders).filter((o) => o.demo && o.status === "paid").slice(0, TEXTS.length);
    buyers.forEach((o, i) => {
      const [text, role, rating] = TEXTS[i];
      const u = auth.listUsers().find((x) => x.email === o.email);
      db.reviews["demo_r" + i] = { id: "demo_r" + i, email: o.email, name: u ? u.name.split(" ")[0] + " " + u.name.split(" ").slice(-1)[0][0] + "." : "Customer", role, rating, text, status: i < 5 ? "approved" : "pending", createdAt: Date.now() - i * DAY, approvedAt: Date.now() - i * DAY, demo: true };
    });
    db.demoSeeded = true;
    saveDb();
    return specs.length;
  }
  function clearDemo() {
    for (const k of Object.keys(db.licenses)) {
      if (db.licenses[k].demo) {
        delete db.licenses[k];
        delete db.activations[k];
      }
    }
    for (const k of Object.keys(db.payments || {})) if (db.payments[k].demo) delete db.payments[k];
    for (const k of Object.keys(db.orders || {})) if (db.orders[k].demo) delete db.orders[k];
    for (const k of Object.keys(db.reviews || {})) if (db.reviews[k].demo) delete db.reviews[k];
    db.demoSeeded = false;
    auth.clearDemoUsers();
    saveDb();
  }

  function usersView(urlObj) {
    const q = (urlObj.searchParams.get("q") || "").trim().toLowerCase();
    const all = urlObj.searchParams.get("all") === "1";
    const page = Math.max(1, parseInt(urlObj.searchParams.get("page") || "1", 10) || 1);
    const size = all ? 5000 : 25;
    const by = licensesByEmail();
    let list = auth.listUsers();
    if (q) list = list.filter((u) => [u.email, u.name, u.phone].some((v) => String(v).toLowerCase().includes(q)));
    list.sort((a, b) => b.createdAt - a.createdAt);
    const total = list.length;
    const rows = list.slice((page - 1) * size, page * size).map((u) => ({ ...u, purchases: by.get(u.email) || 0 }));
    return { total, page, pages: Math.max(1, Math.ceil(total / size)), rows };
  }

  function purchasesView() {
    const rows = Object.entries(db.payments || {})
      .map(([paymentId, p]) => {
        const lic = db.licenses[p.licenseKey] || {};
        return {
          paymentId,
          at: p.at,
          email: p.email || lic.email || "",
          accountEmail: lic.accountEmail || "",
          amount: p.amount || 0,
          currency: p.currency || "",
          keyId: lic.keyId || "",
          devices: (db.activations[p.licenseKey] || []).length,
          maxDevices: lic.maxDevices || 2,
          status: lic.revoked ? "refunded" : "paid",
        };
      })
      .sort((a, b) => b.at - a.at);
    const pending = Object.values(db.orders || {})
      .filter((o) => o.status === "created")
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50)
      .map((o) => ({ email: o.email, name: o.name, at: o.createdAt }));
    return { rows, pending };
  }

  /* ---------------- blog post input ---------------- */
  function parsePost(body) {
    const title = clean(body.title, 110);
    if (title.length < 10) throw new Problem(400, "The title needs at least 10 characters.");
    const description = clean(body.description, 200);
    if (description.length < 50) throw new Problem(400, "The description needs 50 to 200 characters (it shows in Google and on the blog cards).");
    const text = demoteH1(String(body.body || "").replace(/\r\n/g, "\n").slice(0, 400000));
    if (text.trim().length < 200) throw new Problem(400, "The article text is too short (at least 200 characters).");
    const slug = slugify(body.slug || title);
    if (!validSlug(slug)) throw new Problem(400, "The address (slug) needs 3 to 80 letters, numbers and dashes.");
    const tags = (Array.isArray(body.tags) ? body.tags : String(body.tags || "").split(","))
      .map((t) => clean(t, 30).toLowerCase())
      .filter(Boolean)
      .slice(0, 8);
    let pubDate = new Date();
    if (body.pubDate) {
      pubDate = new Date(body.pubDate);
      if (Number.isNaN(pubDate.getTime())) throw new Problem(400, "The publish date is not valid.");
    }
    const faq = (Array.isArray(body.faq) ? body.faq : [])
      .map((f) => ({ q: clean(f && f.q, 200), a: clean(f && f.a, 1200) }))
      .filter((f) => f.q && f.a)
      .slice(0, 12);
    return {
      slug,
      title,
      description,
      body: text,
      tags,
      faq,
      pubDate: pubDate.toISOString().replace(/\.\d{3}Z$/, "Z"),
      author: clean(body.author, 60),
      coverAlt: clean(body.coverAlt, 160),
      draft: body.draft === true,
      featured: body.featured === true,
      cover: "",
      updatedDate: body.editing === true ? new Date().toISOString().replace(/\.\d{3}Z$/, "Z") : "",
      overwrite: body.overwrite === true || body.editing === true,
    };
  }

  /* ---------------- routing ---------------- */
  function requireAdmin(req) {
    const u = auth.currentUser(req);
    if (!u) throw new Problem(401, "Sign in first.");
    if (!auth.isAdmin(u)) throw new Problem(403, "This account is not an admin.");
    return u;
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on("data", (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new Problem(413, "That is too large (4 MB at most)."));
          if (req.destroy) req.destroy();
          return;
        }
        chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      });
      req.on("end", () => {
        try {
          const t = Buffer.concat(chunks).toString("utf8");
          resolve(t ? JSON.parse(t) : {});
        } catch {
          reject(new Problem(400, "Invalid request."));
        }
      });
      req.on("error", reject);
    });
  }

  async function route(req, res, pathname, urlObj) {
    const method = req.method;
    if (limited("admin:" + clientIp(req), 600, 5 * 60 * 1000)) throw new Problem(429, "Too many requests.");
    const me = requireAdmin(req);
    if (method === "POST") {
      const origin = String(req.headers.origin || "").replace(/\/$/, "");
      if (!auth.allowedOrigins.includes(origin)) throw new Problem(403, "This website is not allowed to use the admin API.");
      if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) throw new Problem(415, "Expected JSON.");
    }

    if (method === "GET" && pathname === "/api/admin/me") return send(req, res, 200, { admin: true, email: me.email, name: me.name, publishing: mode(), demoTools: DEV, demoLoaded: !!db.demoSeeded, pendingReviews: Object.values(db.reviews || {}).filter((r) => r.status === "pending").length });
    if (method === "GET" && pathname === "/api/admin/reviews") {
      const order = { pending: 0, approved: 1, rejected: 2 };
      const rows = Object.values(db.reviews || {})
        .map((r) => ({ id: r.id, name: r.name, email: r.email, role: r.role || "", rating: r.rating, text: r.text, status: r.status, at: r.updatedAt || r.createdAt, demo: !!r.demo }))
        .sort((a, b) => order[a.status] - order[b.status] || b.at - a.at);
      return send(req, res, 200, { rows });
    }

    if (method === "POST" && pathname === "/api/admin/reviews") {
      const body = await readBody(req);
      const r = (db.reviews || {})[String(body.id || "")];
      if (!r) throw new Problem(404, "Review not found.");
      if (body.action === "delete") delete db.reviews[r.id];
      else if (body.action === "approve") Object.assign(r, { status: "approved", approvedAt: Date.now() });
      else if (body.action === "reject") r.status = "rejected";
      else throw new Problem(400, "Unknown action.");
      saveDb();
      return send(req, res, 200, { ok: true });
    }

    if (method === "POST" && pathname === "/api/admin/demo") {
      if (!DEV) throw new Problem(404, "Endpoint not found");
      const body = await readBody(req);
      if (body.action === "clear") clearDemo();
      else seedDemo();
      return send(req, res, 200, { ok: true, demoLoaded: !!db.demoSeeded });
    }
    if (method === "GET" && pathname === "/api/admin/stats") return send(req, res, 200, stats(parseInt(urlObj.searchParams.get("days") || "30", 10)));
    if (method === "GET" && pathname === "/api/admin/users") return send(req, res, 200, usersView(urlObj));
    if (method === "GET" && pathname === "/api/admin/purchases") return send(req, res, 200, purchasesView());

    if (method === "POST" && pathname === "/api/admin/license") {
      const body = await readBody(req);
      const entry = Object.entries(db.licenses).find(([, l]) => l.keyId === String(body.keyId || ""));
      if (!entry) throw new Problem(404, "License not found.");
      const [key, lic] = entry;
      lic.revoked = body.revoked === true;
      const pay = Object.values(db.payments || {}).find((p) => p.licenseKey === key);
      const order = pay && pay.orderId && db.orders[pay.orderId];
      if (order) order.revoked = lic.revoked;
      saveDb();
      return send(req, res, 200, { ok: true, keyId: lic.keyId, revoked: lic.revoked });
    }

    if (method === "GET" && pathname === "/api/admin/blog") {
      return send(req, res, 200, { publishing: mode(), posts: await listPosts() });
    }

    if (method === "GET" && pathname === "/api/admin/blog/post") {
      const slug = String(urlObj.searchParams.get("slug") || "");
      if (!validSlug(slug)) throw new Problem(400, "Invalid post address.");
      const text = await readPostFile(slug);
      if (text == null) throw new Problem(404, "Post not found.");
      const post = parsePostFile(text);
      if (!post) throw new Problem(422, "This post uses a layout the editor cannot read. Edit the file in the repository instead.");
      return send(req, res, 200, { slug, ...post });
    }

    if (method === "POST" && pathname === "/api/admin/blog/delete") {
      const body = await readBody(req);
      const slug = String(body.slug || "");
      if (!validSlug(slug)) throw new Problem(400, "Invalid post address.");
      const used = await deletePostFile(slug);
      listCache = { at: 0, mode: "", posts: [] };
      console.log(`[admin] ${me.email} deleted blog post "${slug}" (${used})`);
      return send(req, res, 200, { ok: true, slug, mode: used });
    }

    if (method === "POST" && pathname === "/api/admin/blog/image") {
      const body = await readBody(req);
      const image = decodeImage(body.dataUrl);
      if (!image) throw new Problem(400, "The picture must be a PNG, JPG or WebP up to 2.5 MB.");
      if (mode() === "none") throw new Problem(503, "Publishing is not set up. Set GITHUB_TOKEN and GITHUB_REPO on the server.");
      const name = `post-${require("crypto").randomBytes(5).toString("hex")}.${image.ext}`;
      await putFile(`public/img/blog/${name}`, image.buf, `Blog picture: ${name}`, false);
      return send(req, res, 200, { ok: true, url: `/img/blog/${name}` });
    }

    if (method === "POST" && pathname === "/api/admin/blog") {
      const body = await readBody(req);
      const post = parsePost(body);
      let image = null;
      if (body.coverImage) {
        image = decodeImage(body.coverImage);
        if (!image) throw new Problem(400, "The cover image must be a PNG, JPG or WebP up to 2.5 MB.");
        post.cover = `/img/blog/${post.slug}.${image.ext}`;
      } else if (typeof body.cover === "string" && /^\/img\/[A-Za-z0-9._/-]{1,120}$/.test(body.cover) && !body.cover.includes("..")) {
        post.cover = body.cover;
      }
      if (mode() === "none") throw new Problem(503, "Publishing is not set up. Set GITHUB_TOKEN and GITHUB_REPO on the server (see README, Admin panel).");
      if (image) await putFile(`public${post.cover}`, image.buf, `Blog cover: ${post.slug}`, true);
      const used = await putFile(`src/content/blog/${post.slug}.md`, Buffer.from(buildMarkdown(post), "utf8"), `Blog: ${post.title}`, post.overwrite);
      listCache = { at: 0, mode: "", posts: [] };
      console.log(`[admin] ${me.email} published blog post "${post.slug}" (${used})`);
      return send(req, res, 200, {
        ok: true,
        slug: post.slug,
        mode: used,
        draft: post.draft,
        url: `${ctx.siteUrl()}/blog/${post.slug}/`,
        note: used === "github" ? "Saved to the repository. The post is live once the site finishes rebuilding (usually a minute or two)." : "Saved to the local website folder. Rebuild or restart the site to see it.",
      });
    }

    throw new Problem(404, "Endpoint not found");
  }

  return function handle(req, res, pathname, urlObj) {
    if (!pathname.startsWith("/api/admin/")) return false;
    if (req.method === "OPTIONS") {
      res.writeHead(204, auth.corsHeadersFor(req));
      res.end();
      return true;
    }
    route(req, res, pathname, urlObj).catch((e) => {
      if (e instanceof Problem) return send(req, res, e.status, { error: e.message });
      console.error("[admin] unexpected error:", e);
      send(req, res, 500, { error: "Something went wrong. Please try again." });
    });
    return true;
  };
}

module.exports = { createHandler, buildMarkdown, slugify, frontMatter, decodeImage, parsePostFile, demoteH1 };
