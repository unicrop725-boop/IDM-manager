// scripts/test-website-security.cjs
// Attacks the website's API the way a hostile visitor would. Every test asserts the SECURE behaviour, so a FAIL is a
// real finding. Runs the real server in-process on throwaway databases; blog output goes to temp folders.
//   node scripts/test-website-security.cjs
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fg-websec-"));
const ORIGIN = "https://flowget.net";
const SECRET_B64 = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
Object.assign(process.env, {
  ADMIN_EMAILS: "boss@example.com",
  ALLOWED_ORIGINS: ORIGIN,
  SITE_URL: ORIGIN,
  AUTH_DEV_GOOGLE: "1", // tests only: lets us create accounts without Google
  TRUST_PROXY: "1", // main suite only: each test gets its own client IP so the rate limits of one test cannot hit another
  DODO_PRODUCT_ID: "pdt_flowget_pro",
  DODO_WEBHOOK_SECRET: "whsec_" + SECRET_B64,
  LICENSES_DB: path.join(tmp, "licenses.json"),
  ACCOUNTS_DB: path.join(tmp, "accounts.json"),
  BLOG_DIR: path.join(tmp, "blog"),
  BLOG_IMG_DIR: path.join(tmp, "img"),
});
fs.mkdirSync(process.env.BLOG_DIR);
fs.mkdirSync(process.env.BLOG_IMG_DIR);
delete process.env.GITHUB_TOKEN;
delete process.env.GITHUB_REPO;
delete process.env.NODE_ENV;

const handler = require("../server/license-server.cjs");
const server = http.createServer(handler);

let passed = 0;
let failed = 0;
let curIp = "10.0.0.1";
let ipCounter = 0;
async function test(name, fn) {
  curIp = "10.1." + (ipCounter >> 8) + "." + (ipCounter++ & 255);
  try {
    await fn();
    passed++;
    console.log("  ok  " + name);
  } catch (e) {
    failed++;
    console.error("FAIL  " + name + "\n      " + String(e && e.message).split("\n").join("\n      "));
    process.exitCode = 1;
  }
}

let PORT = 0;
/** Raw HTTP so we control every header (Origin, Host, duplicate headers, odd methods). */
function req(method, p, { origin, cookie, body, raw, ct, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined;
    const h = { "CF-Connecting-IP": curIp, ...headers };
    if (origin !== undefined) h.Origin = origin;
    if (cookie) h.Cookie = cookie;
    if (payload !== undefined) {
      h["Content-Type"] = ct === undefined ? "application/json" : ct;
      h["Content-Length"] = Buffer.byteLength(payload);
    }
    const r = http.request({ host: "127.0.0.1", port: PORT, method, path: p, headers: h }, (res) => {
      let t = "";
      res.on("data", (c) => (t += c));
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(t);
        } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text: t, json });
      });
    });
    r.on("error", reject);
    r.setTimeout(20000, () => r.destroy(new Error("timeout")));
    if (payload !== undefined) r.write(payload);
    r.end();
  });
}
const post = (p, body, o = {}) => req("POST", p, { origin: ORIGIN, body, ...o });
const alive = async () => (await req("GET", "/api/health")).status === 200;

/** Creates an account through the (test-only) fake Google flow and returns its session cookie. */
async function makeUser(email, name = "Test Person") {
  const g = await post("/api/auth/google", { credential: `dev:${email}|${name}` });
  assert.strictEqual(g.status, 200, "google step " + g.text);
  const c = await post("/api/auth/complete", { setupToken: g.json.setupToken, name, phone: "+911234567890", password: "Passw0rdOK1" });
  assert.strictEqual(c.status, 200, "complete step " + c.text);
  return String(c.headers["set-cookie"]).split(";")[0];
}

function webhook(type, data) {
  const body = JSON.stringify({ type, data });
  const id = "msg_" + crypto.randomBytes(8).toString("hex");
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", Buffer.from(SECRET_B64, "base64")).update(`${id}.${ts}.${body}`).digest("base64");
  return req("POST", "/api/webhook/dodo", { raw: body, headers: { "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": "v1," + sig } });
}

server.listen(0, "127.0.0.1", async () => {
  PORT = server.address().port;
  console.log("Website security tests (attacker's view)\n");

  const bossCookie = await makeUser("boss@example.com", "The Boss");
  const aliceCookie = await makeUser("alice@example.com", "Alice Normal");
  const bobCookie = await makeUser("bob@example.com", "Bob Other");

  // ---------------------------------------------------------------- cross-origin rules (CORS / CSRF)
  console.log("Cross-origin rules");
  await test("only the exact allowed origin is reflected, never *, and credentials are explicit", async () => {
    const r = await req("GET", "/api/auth/me", { origin: ORIGIN, cookie: aliceCookie });
    assert.strictEqual(r.headers["access-control-allow-origin"], ORIGIN);
    assert.strictEqual(r.headers["access-control-allow-credentials"], "true");
    assert.ok(/origin/i.test(r.headers.vary || ""), "Vary: Origin so caches cannot mix origins");
  });
  await test("look-alike, downgraded, null and file origins get no CORS access", async () => {
    for (const o of ["https://flowget.net.evil.com", "https://evilflowget.net", "http://flowget.net", "null", "file://", "https://flowget.net:8443", "https://FLOWGET.NET.", "https://flowget.net@evil.com", ORIGIN + "/", "https://sub.flowget.net"]) {
      const r = await req("GET", "/api/auth/me", { origin: o, cookie: aliceCookie });
      const acao = r.headers["access-control-allow-origin"];
      // a trailing slash is normalised by design; everything else must be refused
      if (o === ORIGIN + "/") continue;
      assert.ok(!acao, `origin ${o} was allowed (${acao})`);
    }
  });
  await test("preflight from a foreign site is not approved for any API area", async () => {
    for (const p of ["/api/auth/login", "/api/admin/license", "/api/reviews", "/api/checkout"]) {
      const r = await req("OPTIONS", p, { origin: "https://evil.example", headers: { "Access-Control-Request-Method": "POST" } });
      assert.ok(!r.headers["access-control-allow-origin"], p);
    }
  });
  await test("state-changing POSTs refuse foreign origins, missing Origin, and non-JSON bodies (no form/text CSRF)", async () => {
    const targets = [["/api/auth/login", { email: "a@b.co", password: "x" }], ["/api/auth/logout", {}], ["/api/reviews", { rating: 5, text: "x".repeat(30) }], ["/api/checkout", { email: "a@b.co" }], ["/api/admin/reviews", { id: "x", action: "approve" }]];
    for (const [p, b] of targets) {
      for (const o of ["https://evil.example", undefined, "null"]) {
        const r = await req("POST", p, { origin: o, cookie: bossCookie, body: b });
        assert.ok([401, 403].includes(r.status), `${p} with origin ${o} -> ${r.status}`);
      }
      for (const ct of ["application/x-www-form-urlencoded", "text/plain", "multipart/form-data; boundary=x"]) {
        const r = await req("POST", p, { origin: ORIGIN, cookie: bossCookie, raw: "a=1", ct });
        assert.ok([401, 403, 415].includes(r.status), `${p} as ${ct} -> ${r.status}`);
      }
    }
    assert.ok(await alive());
  });

  // ---------------------------------------------------------------- sessions and cookies
  console.log("Sessions");
  await test("session cookie is HttpOnly + SameSite, Secure over https, and unguessable", async () => {
    const r = await post("/api/auth/google", { credential: "dev:carol@example.com|Carol Test" });
    const c = await post("/api/auth/complete", { setupToken: r.json.setupToken, name: "Carol Test", phone: "+911234567891", password: "Passw0rdOK1" });
    const sc = String(c.headers["set-cookie"]);
    assert.ok(/HttpOnly/i.test(sc) && /SameSite=(Lax|Strict)/i.test(sc) && /Secure/i.test(sc), sc);
    const token = sc.split(";")[0].split("=")[1];
    assert.ok(token.length >= 40, "token has enough entropy");
  });
  await test("forged, truncated, oversized and injected cookies are not sessions", async () => {
    const real = aliceCookie.split("=")[1];
    for (const v of ["", "x", real.slice(0, -2), real + "a", "../../etc/passwd", "a".repeat(8000), "x; fg_session=" + real.slice(0, 10), "'; DROP TABLE users;--", "__proto__", "constructor"]) {
      const r = await req("GET", "/api/auth/me", { cookie: "fg_session=" + v, origin: ORIGIN });
      assert.strictEqual(r.status, 401, JSON.stringify(v.slice(0, 20)));
    }
    // a 100 KB cookie header must be refused by the HTTP layer itself (431 or connection closed), never accepted
    try {
      const r = await req("GET", "/api/auth/me", { cookie: "fg_session=" + "a".repeat(100000), origin: ORIGIN });
      assert.ok(r.status === 431 || r.status === 401, "oversized cookie -> " + r.status);
    } catch (e) {
      assert.ok(/ECONNRESET|socket hang up|EPIPE/.test(String(e.message)), String(e.message));
    }
    assert.ok(await alive());
  });
  await test("logout kills the session server-side (a stolen cookie stops working)", async () => {
    const cookie = await makeUser("dave@example.com", "Dave Test");
    assert.strictEqual((await req("GET", "/api/auth/me", { cookie, origin: ORIGIN })).status, 200);
    await post("/api/auth/logout", {}, { cookie });
    assert.strictEqual((await req("GET", "/api/auth/me", { cookie, origin: ORIGIN })).status, 401);
  });
  await test("a signup setup token works once, cannot be guessed, and /me never leaks the password hash", async () => {
    const g = await post("/api/auth/google", { credential: "dev:erin@example.com|Erin Test" });
    const ok = await post("/api/auth/complete", { setupToken: g.json.setupToken, name: "Erin Test", phone: "+911234567892", password: "Passw0rdOK1" });
    assert.strictEqual(ok.status, 200);
    const again = await post("/api/auth/complete", { setupToken: g.json.setupToken, name: "Evil", phone: "+911234567892", password: "Hacked12345" });
    assert.strictEqual(again.status, 401, "token reuse");
    const me = await req("GET", "/api/auth/me", { cookie: String(ok.headers["set-cookie"]).split(";")[0], origin: ORIGIN });
    assert.ok(!/passwordHash|scrypt|googleSub/i.test(me.text), me.text);
  });

  // ---------------------------------------------------------------- authorization
  console.log("Authorization");
  const adminRoutes = [["GET", "/api/admin/me"], ["GET", "/api/admin/reviews"], ["POST", "/api/admin/reviews", { id: "x", action: "approve" }], ["POST", "/api/admin/demo", { action: "seed" }], ["GET", "/api/admin/stats"], ["GET", "/api/admin/users"], ["GET", "/api/admin/purchases"], ["POST", "/api/admin/license", { keyId: "x", revoked: true }], ["GET", "/api/admin/blog"], ["GET", "/api/admin/blog/post?slug=abc-def"], ["POST", "/api/admin/blog/delete", { slug: "abc-def" }], ["POST", "/api/admin/blog/image", { dataUrl: "x" }], ["POST", "/api/admin/blog", { title: "x" }], ["GET", "/api/admin/does-not-exist"]];
  await test("EVERY admin route refuses anonymous visitors (401) and ordinary signed-in users (403)", async () => {
    for (const [m, p, b] of adminRoutes) {
      const anon = await req(m, p, { origin: ORIGIN, body: b });
      assert.strictEqual(anon.status, 401, `anonymous ${m} ${p} -> ${anon.status}`);
      const user = await req(m, p, { origin: ORIGIN, cookie: aliceCookie, body: b });
      assert.strictEqual(user.status, 403, `ordinary user ${m} ${p} -> ${user.status}`);
    }
  });
  await test("a buyer (has a license) is still not an admin", async () => {
    await webhook("payment.succeeded", { payment_id: "pay_" + crypto.randomBytes(4).toString("hex"), customer: { email: "alice@example.com" }, total_amount: 100, currency: "USD", metadata: {} });
    const me = await req("GET", "/api/auth/me", { cookie: aliceCookie, origin: ORIGIN });
    assert.strictEqual(me.json.isAdmin, false);
    assert.ok(me.json.licenses.length >= 1, "she can see her own license");
    assert.strictEqual((await req("GET", "/api/admin/users", { cookie: aliceCookie, origin: ORIGIN })).status, 403);
  });
  await test("mass assignment: extra fields at signup cannot make anyone admin or change their email", async () => {
    const g = await post("/api/auth/google", { credential: "dev:frank@example.com|Frank Test" });
    const c = await post("/api/auth/complete", { setupToken: g.json.setupToken, name: "Frank Test", phone: "+911234567893", password: "Passw0rdOK1", isAdmin: true, admin: true, role: "admin", email: "boss@example.com", id: "x", userId: "x", profileCompletedAt: 1 });
    const cookie = String(c.headers["set-cookie"]).split(";")[0];
    const me = await req("GET", "/api/auth/me", { cookie, origin: ORIGIN });
    assert.strictEqual(me.json.isAdmin, false);
    assert.strictEqual(me.json.user.email, "frank@example.com");
  });
  await test("admin-look-alike emails do not inherit admin rights", async () => {
    for (const e of ["boss+x@example.com", "boss@example.com.evil.co", "b0ss@example.com", "xboss@example.com", "boss@example.co"]) {
      const cookie = await makeUser(e, "Look Alike");
      const me = await req("GET", "/api/auth/me", { cookie, origin: ORIGIN });
      assert.strictEqual(me.json.isAdmin, false, e);
    }
  });
  await test("the real admin is let in (the gate is not simply closed)", async () => {
    const r = await req("GET", "/api/admin/me", { cookie: bossCookie, origin: ORIGIN });
    assert.strictEqual(r.status, 200);
  });
  await test("reviews: a user only ever sees and edits their own; strangers and non-buyers cannot post", async () => {
    const bobMine = await req("GET", "/api/reviews/mine", { cookie: bobCookie, origin: ORIGIN });
    assert.strictEqual(bobMine.json.canReview, false);
    const posted = await post("/api/reviews", { rating: 5, text: "This is a perfectly fine review text." }, { cookie: bobCookie });
    assert.strictEqual(posted.status, 403, "non-buyer");
    assert.strictEqual((await post("/api/reviews", { rating: 5, text: "x".repeat(30) })).status, 401, "anonymous");
    const ok = await post("/api/reviews", { rating: 4, text: "I really like this download manager, it is fast.", role: "<img src=x onerror=alert(1)>" }, { cookie: aliceCookie });
    assert.strictEqual(ok.status, 200);
    const pub = await req("GET", "/api/reviews");
    assert.ok(!pub.text.includes("alice@example.com"), "pending reviews and emails are not public");
    assert.ok(!(await req("GET", "/api/reviews/mine", { cookie: bobCookie, origin: ORIGIN })).text.includes("really like"), "no cross-user read");
  });

  // ---------------------------------------------------------------- injection / robustness
  console.log("Injection and malformed input");
  await test("prototype pollution through JSON bodies does not touch Object.prototype", async () => {
    const evil = '{"__proto__":{"polluted":"yes","isAdmin":true},"constructor":{"prototype":{"polluted":"yes"}}}';
    for (const p of ["/api/auth/login", "/api/auth/google", "/api/auth/complete", "/api/checkout", "/api/reviews", "/api/license/activate"]) {
      await req("POST", p, { origin: ORIGIN, cookie: aliceCookie, raw: evil });
    }
    assert.strictEqual(({}).polluted, undefined);
    assert.strictEqual(({}).isAdmin, undefined);
  });
  await test("admin review moderation cannot be pointed at Object.prototype (id = __proto__ / constructor)", async () => {
    for (const id of ["__proto__", "constructor", "toString", "hasOwnProperty", "prototype"]) {
      for (const action of ["approve", "reject", "delete"]) {
        await req("POST", "/api/admin/reviews", { origin: ORIGIN, cookie: bossCookie, body: { id, action } });
      }
    }
    assert.strictEqual(({}).status, undefined, "Object.prototype.status was set: every object in the server now has it");
    assert.strictEqual(({}).approvedAt, undefined, "Object.prototype.approvedAt was set");
    assert.ok(await alive());
  });
  await test("null / array / number / string / wrongly-typed bodies are 4xx, never a 500 or a crash, on every POST", async () => {
    const endpoints = ["/api/auth/login", "/api/auth/google", "/api/auth/complete", "/api/checkout", "/api/reviews", "/api/license/activate", "/api/license/deactivate", "/api/admin/reviews", "/api/admin/license", "/api/admin/blog", "/api/admin/blog/delete", "/api/admin/blog/image", "/api/admin/demo"];
    const bodies = ["null", "[]", "5", '"x"', "true", "{", "", '{"email":null}', '{"email":{"a":1},"password":[1],"credential":{},"setupToken":5}', '{"rating":{},"text":[],"role":{}}', '{"title":5,"body":[],"tags":{},"slug":{}}', '{"id":{},"action":[]}', '{"dataUrl":{}}'];
    const bad = [];
    for (const p of endpoints) {
      for (const raw of bodies) {
        const r = await req("POST", p, { origin: ORIGIN, cookie: bossCookie, raw });
        if (r.status >= 500) bad.push(`${p} <- ${raw.slice(0, 30)} = ${r.status}`);
      }
    }
    assert.deepStrictEqual(bad, []);
    assert.ok(await alive());
  });
  await test("errors never leak stack traces, file paths or secrets", async () => {
    const outputs = [];
    for (const [m, p, raw] of [["POST", "/api/checkout", "null"], ["POST", "/api/auth/login", "{"], ["GET", "/api/license/status/%E0%A4%A", ""], ["GET", "/nope", ""], ["POST", "/api/reviews", "null"]]) {
      outputs.push((await req(m, p, { origin: ORIGIN, cookie: aliceCookie, raw: raw || undefined })).text);
    }
    const all = outputs.join("\n");
    assert.ok(!/node_modules|\.cjs|at \w+ \(|C:\\|\/home\/|whsec_|stack/i.test(all), all.slice(0, 400));
  });
  await test("blog admin: path traversal slugs, SVG-as-PNG, YAML/front-matter injection are all rejected or neutralised", async () => {
    for (const slug of ["../../etc/passwd", "..%2f..%2fx", "a/b", "a\\b", "ab", "A B C", "x".repeat(200), "valid-slug\n---\nevil: 1", "a\u0000b"]) {
      const r = await req("GET", "/api/admin/blog/post?slug=" + encodeURIComponent(slug), { origin: ORIGIN, cookie: bossCookie });
      assert.ok([400, 404].includes(r.status), `GET slug ${JSON.stringify(slug)} -> ${r.status}`);
      const d = await post("/api/admin/blog/delete", { slug }, { cookie: bossCookie });
      assert.ok([400, 404].includes(d.status), `DELETE slug ${JSON.stringify(slug)} -> ${d.status}`);
    }
    const svg = "data:image/png;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64");
    const body = { title: "A perfectly valid long title", description: "d".repeat(60), body: "text ".repeat(60), slug: "svg-cover-test", cover: svg, coverImage: svg, image: svg, dataUrl: svg };
    const r = await post("/api/admin/blog", body, { cookie: bossCookie });
    const wrote = fs.readdirSync(process.env.BLOG_IMG_DIR);
    assert.ok(!wrote.some((f) => /svg|html|js/i.test(f)), "no active-content file written: " + wrote);
    assert.ok(r.status < 500);
    const up = await post("/api/admin/blog/image", { dataUrl: svg }, { cookie: bossCookie });
    assert.ok(up.status >= 400, "an SVG pretending to be a PNG must be refused, got " + up.status);
    // injected front matter: the title may contain newlines and --- but must stay inside one quoted value
    const t = "Title line one\n---\nevil: true\ndraft: false that is long enough";
    const w = await post("/api/admin/blog", { title: t, description: "d".repeat(60), body: "x".repeat(250), slug: "yaml-injection-test" }, { cookie: bossCookie });
    if (w.status === 200) {
      const file = fs.readFileSync(path.join(process.env.BLOG_DIR, "yaml-injection-test.md"), "utf8");
      const fm = file.split("\n---\n")[0];
      assert.ok(!/^evil:/m.test(file), "injected key reached the front matter:\n" + fm);
    }
  });

  // ---------------------------------------------------------------- brute force, enumeration, DoS
  console.log("Brute force, enumeration, abuse");
  await test("login does not reveal whether an email has an account (same status, same message)", async () => {
    const a = await post("/api/auth/login", { email: "alice@example.com", password: "WrongPass123" });
    const b = await post("/api/auth/login", { email: "nobody-at-all@example.com", password: "WrongPass123" });
    assert.strictEqual(a.status, b.status);
    assert.strictEqual(a.json.error, b.json.error);
  });
  await test("login response time does not reveal which emails exist (scrypt runs for unknown emails too)", async () => {
    const time = async (email) => {
      const t0 = process.hrtime.bigint();
      await post("/api/auth/login", { email, password: "WrongPass123" });
      return Number(process.hrtime.bigint() - t0) / 1e6;
    };
    const known = [], unknown = [];
    for (let i = 0; i < 4; i++) {
      known.push(await time("bob@example.com"));
      unknown.push(await time(`ghost${i}@example.com`));
    }
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const ratio = Math.max(avg(known), avg(unknown)) / Math.min(avg(known), avg(unknown));
    assert.ok(ratio < 3, `timing differs ${ratio.toFixed(1)}x (known ${avg(known).toFixed(0)}ms vs unknown ${avg(unknown).toFixed(0)}ms)`);
  });
  await test("password guessing is cut off (429) per email and per IP", async () => {
    let got429 = 0;
    for (let i = 0; i < 14; i++) {
      const r = await post("/api/auth/login", { email: "carol@example.com", password: "Guess" + i + "word1" });
      if (r.status === 429) got429++;
    }
    assert.ok(got429 >= 1, "no lock-out after 14 wrong guesses");
    // even the RIGHT password is refused while locked out, so guessing cannot continue by luck
    assert.strictEqual((await post("/api/auth/login", { email: "carol@example.com", password: "Passw0rdOK1" })).status, 429);
  });
  await test("default config: forged X-Forwarded-For / CF-Connecting-IP headers give no fresh rate-limit allowance", async () => {
    const { spawn } = require("child_process");
    const env = { ...process.env, ACCOUNTS_DB: path.join(tmp, "acc-child.json"), LICENSES_DB: path.join(tmp, "lic-child.json") };
    delete env.TRUST_PROXY;
    const child = spawn(process.execPath, ["-e", 'const h=require(process.argv[1]);const s=require("http").createServer(h).listen(0,"127.0.0.1",()=>console.log("PORT="+s.address().port));', path.join(__dirname, "..", "server", "license-server.cjs")], { env, stdio: ["ignore", "pipe", "ignore"] });
    try {
      const port = await new Promise((resolve, reject) => {
        let buf = "";
        child.stdout.on("data", (d) => {
          buf += d;
          const m = /PORT=([0-9]+)/.exec(buf);
          if (m) resolve(Number(m[1]));
        });
        setTimeout(() => reject(new Error("child server did not start")), 15000);
      });
      let limited = false;
      for (let i = 0; i < 40; i++) {
        const body = JSON.stringify({ email: `spoof${i}@example.com`, password: "x" });
        const status = await new Promise((resolve, reject) => {
          const r = http.request({ host: "127.0.0.1", port, method: "POST", path: "/api/auth/login", headers: { Origin: ORIGIN, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "X-Forwarded-For": `10.9.${i}.1`, "CF-Connecting-IP": `10.8.${i}.1` } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
          r.on("error", reject);
          r.end(body);
        });
        if (status === 429) limited = true;
      }
      assert.ok(limited, "40 attempts with rotating forged IP headers were never limited");
    } finally {
      child.kill();
    }
  });
  await test("passwords: weak ones refused, over-long ones cannot be used to burn CPU, wrong types handled", async () => {
    const g = await post("/api/auth/google", { credential: "dev:grace@example.com|Grace Test" });
    for (const pw of ["short1", "allletters", "12345678", "a".repeat(129) + "1", "grace@example.com", null, 12345678, ["a1b2c3d4e5"], {}]) {
      const r = await post("/api/auth/complete", { setupToken: g.json.setupToken, name: "Grace Test", phone: "+911234567894", password: pw });
      assert.strictEqual(r.status, 400, JSON.stringify(pw).slice(0, 30) + " -> " + r.status);
    }
    // 1 MB is cut off by the 16 KB body cap (connection closed); just under the cap must still be answered fast,
    // because only the first 128 characters of a password are ever hashed.
    try {
      await post("/api/auth/login", { email: "alice@example.com", password: "A1".repeat(500000) });
    } catch (e) {
      assert.ok(/ECONNRESET|socket hang up|EPIPE/.test(String(e.message)), String(e.message));
    }
    const t0 = Date.now();
    const big = await post("/api/auth/login", { email: "alice@example.com", password: "A1".repeat(7000) });
    assert.ok(big.status === 401 || big.status === 429, "got " + big.status);
    assert.ok(Date.now() - t0 < 3000, "a 14 KB password must not make login slow");
  });
  await test("oversized request bodies are rejected without taking the server down", async () => {
    for (const p of ["/api/auth/login", "/api/reviews", "/api/checkout", "/api/admin/reviews"]) {
      try {
        await req("POST", p, { origin: ORIGIN, cookie: bossCookie, raw: '{"a":"' + "x".repeat(6 * 1024 * 1024) + '"}' });
      } catch {}
    }
    assert.ok(await alive());
  });
  await test("order status ids: only well-formed ids are looked up, unknown ones leak nothing", async () => {
    for (const id of ["", "x", "ord_" + "0".repeat(32), "ord_" + "g".repeat(32), "__proto__", "constructor", "ord_" + "f".repeat(31) + "'", "../../x"]) {
      const r = await req("GET", "/api/checkout/status?order=" + encodeURIComponent(id), { origin: ORIGIN });
      assert.strictEqual(r.status, 404, JSON.stringify(id));
      assert.ok(!/licenseKey|FG1\./.test(r.text));
    }
  });
  await test("checkout: header-injection and absurd input is refused before any payment call", async () => {
    for (const b of [{ email: "a@b.co\r\nBcc: x@y.z" }, { email: "a b@c.co" }, { email: "x".repeat(400) + "@a.co" }, { email: ["a@b.co"] }, { email: { a: 1 } }, {}]) {
      const r = await post("/api/checkout", b);
      assert.ok([400, 503].includes(r.status), JSON.stringify(b).slice(0, 40) + " -> " + r.status);
    }
  });

  // ---------------------------------------------------------------- payment webhook
  console.log("Payment webhook");
  await test("webhook refuses every kind of bad signature", async () => {
    const body = JSON.stringify({ type: "payment.succeeded", data: { payment_id: "pay_forged1", customer: { email: "thief@example.com" }, total_amount: 1, currency: "USD", metadata: {} } });
    const id = "msg_forge1";
    const ts = Math.floor(Date.now() / 1000);
    const good = crypto.createHmac("sha256", Buffer.from(SECRET_B64, "base64")).update(`${id}.${ts}.${body}`).digest("base64");
    const wrongKey = crypto.createHmac("sha256", Buffer.from("another-secret-key-another-secret")).update(`${id}.${ts}.${body}`).digest("base64");
    const cases = [
      ["no headers", {}],
      ["empty signature", { "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": "" }],
      ["wrong key", { "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": "v1," + wrongKey }],
      ["right sig, other body", { "webhook-id": id + "x", "webhook-timestamp": String(ts), "webhook-signature": "v1," + good }],
      ["stale timestamp", { "webhook-id": id, "webhook-timestamp": String(ts - 3600), "webhook-signature": "v1," + crypto.createHmac("sha256", Buffer.from(SECRET_B64, "base64")).update(`${id}.${ts - 3600}.${body}`).digest("base64") }],
      ["future timestamp", { "webhook-id": id, "webhook-timestamp": String(ts + 3600), "webhook-signature": "v1," + crypto.createHmac("sha256", Buffer.from(SECRET_B64, "base64")).update(`${id}.${ts + 3600}.${body}`).digest("base64") }],
      ["v0 scheme", { "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": "v0," + good }],
      ["non-numeric timestamp", { "webhook-id": id, "webhook-timestamp": "abc", "webhook-signature": "v1," + good }],
    ];
    for (const [why, headers] of cases) {
      const r = await req("POST", "/api/webhook/dodo", { raw: body, headers });
      assert.ok(r.status === 401 || r.status === 400, `${why} -> ${r.status}`);
    }
    const lic = JSON.parse(fs.readFileSync(process.env.LICENSES_DB, "utf8"));
    assert.ok(!Object.values(lic.licenses).some((l) => l.email === "thief@example.com"), "no license was issued to the forger");
  });
  await test("a payment for the wrong amount or product is not turned into a license (checked against what we sell)", async () => {
    const before = Object.keys(handler.db.licenses).length;
    await webhook("payment.succeeded", { payment_id: "pay_cheap_" + crypto.randomBytes(3).toString("hex"), customer: { email: "cheap@example.com" }, total_amount: 1, currency: "USD", metadata: {}, product_cart: [{ product_id: "some_other_product", quantity: 1 }] });
    const after = Object.keys(handler.db.licenses).length;
    assert.strictEqual(after, before, "a license was issued for a 1-cent payment on an unrelated product");
    // ...while our own product still works, with the cart present or (older payload shape) absent
    await webhook("payment.succeeded", { payment_id: "pay_ours_a" + crypto.randomBytes(3).toString("hex"), customer: { email: "ours-a@example.com" }, total_amount: 100, currency: "USD", metadata: {}, product_cart: [{ product_id: "pdt_flowget_pro", quantity: 1 }] });
    await webhook("payment.succeeded", { payment_id: "pay_ours_b" + crypto.randomBytes(3).toString("hex"), customer: { email: "ours-b@example.com" }, total_amount: 100, currency: "USD", metadata: {} });
    assert.strictEqual(Object.keys(handler.db.licenses).length, before + 2, "genuine purchases must still issue licenses");
  });

  // ---------------------------------------------------------------- HTTP odds and ends
  console.log("HTTP behaviour");
  await test("odd methods, hostile paths and weird Host headers do not crash or expose files", async () => {
    for (const [m, p, h] of [["TRACE", "/api/health", {}], ["PUT", "/api/auth/login", {}], ["DELETE", "/api/admin/blog", {}], ["GET", "/../../etc/passwd", {}], ["GET", "/api/%00", {}], ["GET", "/api/license/status/%", {}], ["GET", "/.env", {}], ["GET", "/server/.env", {}], ["GET", "/licenses_db.json", {}], ["GET", "/api/health", { Host: "evil.example" }], ["GET", "/api/health", { Host: "a".repeat(5000) }]]) {
      try {
        const r = await req(m, p, { origin: ORIGIN, headers: h });
        assert.ok(r.status < 500, `${m} ${p} -> ${r.status}`);
        assert.ok(!/ADMIN_EMAILS|AUTH_DEV_GOOGLE|PRIVATE|root:|\[boot loader\]/i.test(r.text), `${p} leaked content`);
      } catch (e) {
        if (!/socket hang up|ECONNRESET|HPE_|timeout/i.test(String(e.message))) throw e;
      }
    }
    assert.ok(await alive());
  });
  await test("API answers are never cacheable when they carry account data", async () => {
    for (const p of ["/api/auth/me", "/api/reviews/mine", "/api/admin/me"]) {
      const r = await req("GET", p, { origin: ORIGIN, cookie: bossCookie });
      assert.ok(/no-store/.test(r.headers["cache-control"] || ""), `${p}: ${r.headers["cache-control"]}`);
      assert.strictEqual(r.headers["x-content-type-options"], "nosniff", p);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  server.close();
  process.exit(process.exitCode || 0);
});
