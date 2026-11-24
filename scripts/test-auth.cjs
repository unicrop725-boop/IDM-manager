// Tests the account flow of server/auth.cjs end to end: Google -> name/phone/password -> email login.
// Run: node scripts/test-auth.cjs
const os = require("os");
const fs = require("fs");
const path = require("path");
const http = require("http");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fg-auth-"));
process.env.ACCOUNTS_DB = path.join(tmp, "accounts.json");
process.env.AUTH_DEV_GOOGLE = "1";
process.env.ALLOWED_ORIGINS = "http://site.test";
delete process.env.GOOGLE_CLIENT_ID;

const handler = require("../server/license-server.cjs");
const ORIGIN = "http://site.test";
let pass = 0;
let fail = 0;
const check = (name, ok, extra) => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + (extra || "")}`);
};

const server = http.createServer(handler).listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body, opts = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: {
        ...(body !== undefined || opts.json !== false ? { "Content-Type": opts.contentType || "application/json" } : {}),
        Origin: opts.origin === undefined ? ORIGIN : opts.origin,
        ...(opts.cookie ? { Cookie: opts.cookie } : {}),
      },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json = {};
    try { json = JSON.parse(text); } catch {}
    const sc = res.headers.get("set-cookie") || "";
    return { status: res.status, json, text, cookie: sc.split(";")[0], setCookie: sc, headers: res.headers };
  };

  try {
    const cfg = await call("GET", "/api/auth/config");
    check("config is public and reports no client id", cfg.status === 200 && cfg.json.googleClientId === null && cfg.json.devGoogle === true);

    const g1 = await call("POST", "/api/auth/google", { credential: "dev:jordan@acme.io|Jordan Lee" });
    check("new Google user needs a profile", g1.status === 200 && g1.json.status === "needs_profile" && g1.json.email === "jordan@acme.io" && g1.json.name === "Jordan Lee" && !!g1.json.setupToken && !g1.setCookie, JSON.stringify(g1.json));
    const setup = g1.json.setupToken;

    const early = await call("POST", "/api/auth/login", { email: "jordan@acme.io", password: "Passw0rd123" });
    check("cannot log in with a password before finishing the account", early.status === 401);

    check("me without a session is 401", (await call("GET", "/api/auth/me")).status === 401);

    const badSetup = await call("POST", "/api/auth/complete", { setupToken: "nope", name: "Jordan Lee", phone: "+91 98765 43210", password: "Passw0rd123" });
    check("bad setup token is rejected", badSetup.status === 401);
    const badName = await call("POST", "/api/auth/complete", { setupToken: setup, name: "J", phone: "+919876543210", password: "Passw0rd123" });
    check("short name rejected", badName.status === 400);
    const badPhone = await call("POST", "/api/auth/complete", { setupToken: setup, name: "Jordan Lee", phone: "12ab", password: "Passw0rd123" });
    check("bad phone rejected", badPhone.status === 400);
    const weak = await call("POST", "/api/auth/complete", { setupToken: setup, name: "Jordan Lee", phone: "+919876543210", password: "short" });
    check("weak password rejected", weak.status === 400);
    const noNum = await call("POST", "/api/auth/complete", { setupToken: setup, name: "Jordan Lee", phone: "+919876543210", password: "onlyletters" });
    check("password without a number rejected", noNum.status === 400);

    const done = await call("POST", "/api/auth/complete", { setupToken: setup, name: "  Jordan   Lee ", phone: "+91 98765-43210", password: "Passw0rd123" });
    check("complete signs the person in", done.status === 200 && done.json.status === "signed_in" && done.json.user.name === "Jordan Lee" && done.json.user.phone === "+919876543210", JSON.stringify(done.json));
    check("session cookie is HttpOnly + SameSite", /HttpOnly/i.test(done.setCookie) && /SameSite=Lax/i.test(done.setCookie), done.setCookie);
    check("responses never include the password hash", !/passwordHash|scrypt/.test(done.text));

    const reuse = await call("POST", "/api/auth/complete", { setupToken: setup, name: "Someone", phone: "+919876543210", password: "Passw0rd123" });
    check("setup token cannot be reused", reuse.status === 401);

    const me = await call("GET", "/api/auth/me", undefined, { cookie: done.cookie });
    check("me returns the profile", me.status === 200 && me.json.user.email === "jordan@acme.io" && Array.isArray(me.json.licenses), JSON.stringify(me.json));

    const out = await call("POST", "/api/auth/logout", {}, { cookie: done.cookie });
    check("logout works", out.status === 200);
    check("session is dead after logout", (await call("GET", "/api/auth/me", undefined, { cookie: done.cookie })).status === 401);

    const login = await call("POST", "/api/auth/login", { email: "Jordan@Acme.io", password: "Passw0rd123", remember: true });
    check("email + password login works (case-insensitive email)", login.status === 200 && login.json.status === "signed_in");
    check("remember me gives a long-lived cookie", /Max-Age=\d{6,}/.test(login.setCookie), login.setCookie);
    const login2 = await call("POST", "/api/auth/login", { email: "jordan@acme.io", password: "Passw0rd123" });
    check("without remember it is a session cookie", !/Max-Age/.test(login2.setCookie));

    const wrong = await call("POST", "/api/auth/login", { email: "jordan@acme.io", password: "WrongPass1" });
    const ghost = await call("POST", "/api/auth/login", { email: "nobody@acme.io", password: "WrongPass1" });
    check("wrong password and unknown email give the same answer", wrong.status === 401 && ghost.status === 401 && wrong.json.error === ghost.json.error);

    const g2 = await call("POST", "/api/auth/google", { credential: "dev:jordan@acme.io|Jordan Lee" });
    check("returning Google user is signed in straight away", g2.status === 200 && g2.json.status === "signed_in" && /fg_session=/.test(g2.setCookie));

    check("real Google credentials fail when no client id is configured", (await call("POST", "/api/auth/google", { credential: "a.b.c" })).status === 503);

    const evil = await call("POST", "/api/auth/login", { email: "jordan@acme.io", password: "Passw0rd123" }, { origin: "http://evil.test" });
    check("other websites cannot post", evil.status === 403);
    const noOrigin = await call("POST", "/api/auth/login", { email: "jordan@acme.io", password: "Passw0rd123" }, { origin: "" });
    check("posts without an Origin are refused", noOrigin.status === 403);
    const form = await call("POST", "/api/auth/login", "email=jordan%40acme.io&password=Passw0rd123", { contentType: "application/x-www-form-urlencoded" });
    check("form posts are refused", form.status === 415);
    const pre = await fetch(base + "/api/auth/login", { method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST" } });
    check("CORS preflight allows our site with credentials", pre.status === 204 && pre.headers.get("access-control-allow-origin") === ORIGIN && pre.headers.get("access-control-allow-credentials") === "true");
    const pre2 = await fetch(base + "/api/auth/login", { method: "OPTIONS", headers: { Origin: "http://evil.test" } });
    check("CORS preflight does not allow other sites", !pre2.headers.get("access-control-allow-origin"));

    let last;
    for (let i = 0; i < 12; i++) last = await call("POST", "/api/auth/login", { email: "limit@acme.io", password: "WrongPass1" });
    check("repeated failures are rate limited", last.status === 429, String(last.status));

    const raw = fs.readFileSync(process.env.ACCOUNTS_DB, "utf8");
    check("password is stored hashed, not in plain text", !raw.includes("Passw0rd123") && raw.includes("scrypt$"));

    const lic = await call("GET", "/api/health", undefined, { json: false });
    check("existing license endpoints still answer", lic.status === 200 && lic.json.status === "healthy");
  } catch (e) {
    fail++;
    console.error("test crashed:", e);
  }
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
