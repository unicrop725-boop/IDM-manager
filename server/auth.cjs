// server/auth.cjs
// FlowGet accounts: "Continue with Google", then the person adds their name, phone number and a password,
// and can sign in with email + password from then on. Zero dependencies (Node crypto + https only).
//
// Routes (all under /api/auth, JSON in and out):
//   GET  /config     public settings for the sign-in page (Google client id)
//   POST /google     { credential }                      Google ID token -> signed in, or "needs_profile"
//   POST /complete   { setupToken, name, phone, password }   finish a new account, signs in
//   POST /login      { email, password, remember }
//   GET  /me         the signed-in person (+ license keys bought with their email)
//   POST /logout
//
// Environment:
//   GOOGLE_CLIENT_ID   OAuth "Web application" client id from Google Cloud Console (required for real Google sign-in)
//   ALLOWED_ORIGINS    comma separated website origins allowed to call this API (default: flowget.net + local dev)
//   COOKIE_DOMAIN      optional, e.g. ".flowget.net" to share the session cookie between subdomains
//   TRUST_PROXY=1      read the client IP from CF-Connecting-IP / X-Forwarded-For (when behind Cloudflare or a proxy)
//   ACCOUNTS_DB        path of the accounts file (default server/accounts_db.json)
//   AUTH_DEV_GOOGLE=1  LOCAL TESTING ONLY: accepts the fake credential "dev:email|Name" instead of a real Google token

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const https = require("https");

const DB_FILE = process.env.ACCOUNTS_DB || path.join(__dirname, "accounts_db.json");
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const DEV_GOOGLE = process.env.AUTH_DEV_GOOGLE === "1";
// The fake Google login lets anyone sign in as ANY address, including the admin (who can issue licenses for free).
// A comment saying "remove before going live" is not a safeguard, so a production process refuses to start with it on.
if (DEV_GOOGLE && process.env.NODE_ENV === "production") {
  throw new Error(
    "AUTH_DEV_GOOGLE=1 with NODE_ENV=production: refusing to start. The fake login would let anyone sign in as the admin. Remove AUTH_DEV_GOOGLE from the environment and from server/.env.",
  );
}
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || "";
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "https://flowget.net,https://www.flowget.net,http://localhost:4321,http://127.0.0.1:4321,http://localhost:4399,http://localhost:4400")
  .split(",")
  .map((s) => s.trim().replace(/\/$/, ""))
  .filter(Boolean);

// Emails allowed into the admin panel (/api/admin, website /admin/). Empty = nobody.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const isAdmin = (u) => !!u && ADMIN_EMAILS.includes(String(u.email).toLowerCase());

const COOKIE = "fg_session";
const DAY = 86400000;
const SESSION_SHORT = DAY; // not "remembered": one day
const SESSION_LONG = 30 * DAY; // "keep me signed in on this device"
const SETUP_TTL = 30 * 60 * 1000; // time allowed to finish a new account after Google
const MAX_BODY = 16 * 1024;

if (DEV_GOOGLE) console.warn("[auth] AUTH_DEV_GOOGLE=1: fake Google credentials are accepted. Never use this in production.");

/* ---------------- storage ---------------- */
let db = { users: {}, sessions: {}, setup: {} };
if (fs.existsSync(DB_FILE)) {
  try {
    db = { users: {}, sessions: {}, setup: {}, ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) };
  } catch (e) {
    console.error("[auth] could not read accounts file, starting empty:", e.message);
  }
}
function save() {
  try {
    const tmp = DB_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(db), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, DB_FILE);
  } catch (e) {
    console.error("[auth] could not save accounts:", e.message);
  }
}
function sweep() {
  const now = Date.now();
  let changed = false;
  for (const t of ["sessions", "setup"]) {
    for (const k of Object.keys(db[t])) {
      if (db[t][k].expires < now) {
        delete db[t][k];
        changed = true;
      }
    }
  }
  if (changed) save();
}
setInterval(sweep, 10 * 60 * 1000).unref();

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const findByEmail = (email) => Object.values(db.users).find((u) => u.email === email);

/* ---------------- passwords ---------------- */
const SCRYPT = { N: 16384, r: 8, p: 1 };
function scrypt(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, SCRYPT, (err, key) => (err ? reject(err) : resolve(key)));
  });
}
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}
async function checkPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts[0] !== "scrypt" || parts.length !== 6) return false;
  const salt = Buffer.from(parts[4], "base64");
  const want = Buffer.from(parts[5], "base64");
  const got = await scrypt(password, salt);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
// Used when the email is unknown, so "no such account" and "wrong password" take the same time.
const DUMMY_HASH = "scrypt$16384$8$1$" + Buffer.alloc(16).toString("base64") + "$" + Buffer.alloc(64).toString("base64");

/* ---------------- validation ---------------- */
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
function cleanEmail(v) {
  const e = String(v || "").trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : "";
}
function cleanName(v) {
  // eslint-disable-next-line no-control-regex
  const n = String(v || "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return n.length >= 2 && n.length <= 80 ? n : "";
}
function cleanPhone(v) {
  const p = String(v || "").replace(/[\s().-]/g, "");
  return /^\+?[0-9]{7,15}$/.test(p) ? p : "";
}
function passwordProblem(pw, email) {
  if (typeof pw !== "string" || pw.length < 8) return "Use at least 8 characters for the password.";
  if (pw.length > 128) return "The password is too long (128 characters at most).";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "Use letters and at least one number in the password.";
  if (email && pw.toLowerCase() === email) return "The password cannot be your email address.";
  return "";
}

/* ---------------- rate limiting (per process) ---------------- */
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return arr.length > max;
}
function clientIp(req) {
  if (TRUST_PROXY) {
    const h = req.headers["cf-connecting-ip"] || String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (h) return h;
  }
  return req.socket.remoteAddress || "unknown";
}

/* ---------------- Google ID token ---------------- */
let jwksCache = { keys: [], at: 0 };
function fetchJwks() {
  return new Promise((resolve, reject) => {
    https
      .get("https://www.googleapis.com/oauth2/v3/certs", { timeout: 8000 }, (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(raw).keys || []);
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject)
      .on("timeout", function () {
        this.destroy(new Error("timeout"));
      });
  });
}
async function googleKeys(force) {
  if (force || Date.now() - jwksCache.at > 60 * 60 * 1000 || !jwksCache.keys.length) {
    jwksCache = { keys: await fetchJwks(), at: Date.now() };
  }
  return jwksCache.keys;
}
class Problem extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
async function verifyGoogle(credential) {
  if (typeof credential !== "string" || credential.length > 4096) throw new Problem(400, "Missing Google credential.");
  if (DEV_GOOGLE && credential.startsWith("dev:")) {
    const [rawEmail, rawName] = credential.slice(4).split("|");
    const email = cleanEmail(rawEmail);
    if (!email) throw new Problem(400, "Invalid test email.");
    return { email, name: cleanName(rawName) || "", sub: "dev-" + email };
  }
  if (!GOOGLE_CLIENT_ID) throw new Problem(503, "Google sign-in is not set up on this server yet.");
  const parts = credential.split(".");
  if (parts.length !== 3) throw new Problem(401, "Google sign-in failed.");
  let header, payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new Problem(401, "Google sign-in failed.");
  }
  if (header.alg !== "RS256" || !header.kid) throw new Problem(401, "Google sign-in failed.");
  let keys;
  try {
    keys = await googleKeys(false);
    if (!keys.find((k) => k.kid === header.kid)) keys = await googleKeys(true);
  } catch {
    throw new Problem(502, "Could not reach Google to check the sign-in. Try again.");
  }
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Problem(401, "Google sign-in failed.");
  const ok = crypto.verify("RSA-SHA256", Buffer.from(parts[0] + "." + parts[1]), crypto.createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url"));
  const now = Math.floor(Date.now() / 1000);
  if (
    !ok ||
    !["https://accounts.google.com", "accounts.google.com"].includes(payload.iss) ||
    payload.aud !== GOOGLE_CLIENT_ID ||
    !(payload.exp > now - 30) ||
    !(payload.iat <= now + 300)
  ) {
    throw new Problem(401, "Google sign-in failed.");
  }
  const email = cleanEmail(payload.email);
  if (!email || payload.email_verified !== true) throw new Problem(401, "Your Google email address is not verified.");
  return { email, name: cleanName(payload.name) || "", sub: String(payload.sub || "") };
}

/* ---------------- sessions ---------------- */
function newToken() {
  return crypto.randomBytes(32).toString("base64url");
}
function cookieFlags(req, maxAgeMs) {
  const origin = String(req.headers.origin || "");
  const secure = origin.startsWith("https://") || process.env.COOKIE_SECURE === "1";
  let f = "; Path=/; HttpOnly; SameSite=Lax";
  if (secure) f += "; Secure";
  if (COOKIE_DOMAIN) f += `; Domain=${COOKIE_DOMAIN}`;
  if (maxAgeMs != null) f += `; Max-Age=${Math.floor(maxAgeMs / 1000)}`;
  return f;
}
function startSession(req, userId, remember) {
  const token = newToken();
  const ttl = remember ? SESSION_LONG : SESSION_SHORT;
  db.sessions[sha(token)] = { userId, expires: Date.now() + ttl, created: Date.now() };
  save();
  return `${COOKIE}=${token}${cookieFlags(req, remember ? ttl : null)}`;
}
function readCookie(req) {
  const m = String(req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? m[1] : "";
}
function currentUser(req) {
  const token = readCookie(req);
  if (!token) return null;
  const s = db.sessions[sha(token)];
  if (!s || s.expires < Date.now()) return null;
  return db.users[s.userId] || null;
}
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, phone: u.phone, createdAt: u.createdAt });

/* ---------------- http helpers ---------------- */
function corsHeaders(req) {
  const origin = String(req.headers.origin || "").replace(/\/$/, "");
  const h = { Vary: "Origin" };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Credentials"] = "true";
    h["Access-Control-Allow-Headers"] = "Content-Type";
    h["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    h["Access-Control-Max-Age"] = "600";
  }
  return h;
}
function send(req, res, status, data, extraHeaders) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...corsHeaders(req),
    ...(extraHeaders || {}),
  });
  res.end(JSON.stringify(data));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Problem(413, "Request too large."));
        req.destroy();
        return;
      }
      raw += c;
    });
    req.on("end", () => {
      try {
        const v = raw ? JSON.parse(raw) : {};
        // null, arrays, numbers and strings are valid JSON but not a request we understand (and would crash a handler).
        if (v === null || typeof v !== "object" || Array.isArray(v)) return reject(new Problem(400, "Expected a JSON object."));
        resolve(v);
      } catch {
        reject(new Problem(400, "Invalid request."));
      }
    });
    req.on("error", reject);
  });
}

/* ---------------- routes ---------------- */
let licensesFor = () => [];

async function route(req, res, pathname) {
  const method = req.method;
  const origin = String(req.headers.origin || "").replace(/\/$/, "");

  if (method === "POST") {
    // CSRF: only our own website may post, and only as JSON (which a plain HTML form cannot send).
    if (!ALLOWED_ORIGINS.includes(origin)) throw new Problem(403, "This website is not allowed to use the sign-in service.");
    if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) throw new Problem(415, "Expected JSON.");
  }

  if (method === "GET" && pathname === "/api/auth/config") {
    return send(req, res, 200, { googleClientId: GOOGLE_CLIENT_ID || null, devGoogle: DEV_GOOGLE });
  }

  if (method === "GET" && pathname === "/api/auth/me") {
    const u = currentUser(req);
    if (!u) return send(req, res, 401, { error: "Not signed in." });
    return send(req, res, 200, { user: publicUser(u), licenses: licensesFor(u.email), isAdmin: isAdmin(u) });
  }

  if (method === "POST" && pathname === "/api/auth/logout") {
    const t = readCookie(req);
    if (t && db.sessions[sha(t)]) {
      delete db.sessions[sha(t)];
      save();
    }
    return send(req, res, 200, { ok: true }, { "Set-Cookie": `${COOKIE}=${cookieFlags(req, 0)}` });
  }

  if (method === "POST" && pathname === "/api/auth/google") {
    if (limited("google:" + clientIp(req), 30, 15 * 60 * 1000)) throw new Problem(429, "Too many attempts. Try again in a few minutes.");
    const body = await readJson(req);
    const g = await verifyGoogle(body.credential);
    let user = findByEmail(g.email);
    if (!user) {
      user = { id: crypto.randomUUID(), email: g.email, name: "", phone: "", passwordHash: "", googleSub: g.sub, createdAt: Date.now(), profileCompletedAt: 0 };
      db.users[user.id] = user;
      save();
    } else if (!user.googleSub) {
      user.googleSub = g.sub;
      save();
    }
    if (user.profileCompletedAt) {
      return send(req, res, 200, { status: "signed_in", user: publicUser(user) }, { "Set-Cookie": startSession(req, user.id, true) });
    }
    const setupToken = newToken();
    db.setup[sha(setupToken)] = { userId: user.id, expires: Date.now() + SETUP_TTL };
    save();
    return send(req, res, 200, { status: "needs_profile", setupToken, email: user.email, name: g.name || user.name || "" });
  }

  if (method === "POST" && pathname === "/api/auth/complete") {
    if (limited("complete:" + clientIp(req), 20, 15 * 60 * 1000)) throw new Problem(429, "Too many attempts. Try again in a few minutes.");
    const body = await readJson(req);
    const rec = typeof body.setupToken === "string" ? db.setup[sha(body.setupToken)] : null;
    if (!rec || rec.expires < Date.now()) throw new Problem(401, "This step has expired. Continue with Google again.");
    const user = db.users[rec.userId];
    if (!user) throw new Problem(401, "This step has expired. Continue with Google again.");
    const name = cleanName(body.name);
    const phone = cleanPhone(body.phone);
    if (!name) throw new Problem(400, "Enter your full name (2 to 80 characters).");
    if (!phone) throw new Problem(400, "Enter a valid phone number, with country code if outside India (7 to 15 digits).");
    const pwProblem = passwordProblem(body.password, user.email);
    if (pwProblem) throw new Problem(400, pwProblem);
    user.name = name;
    user.phone = phone;
    user.passwordHash = await hashPassword(body.password);
    user.profileCompletedAt = Date.now();
    delete db.setup[sha(body.setupToken)];
    return send(req, res, 200, { status: "signed_in", user: publicUser(user) }, { "Set-Cookie": startSession(req, user.id, true) });
  }

  if (method === "POST" && pathname === "/api/auth/login") {
    const body = await readJson(req);
    const email = cleanEmail(body.email);
    const password = typeof body.password === "string" ? body.password : "";
    if (limited("login-ip:" + clientIp(req), 30, 15 * 60 * 1000) || (email && limited("login-email:" + email, 10, 15 * 60 * 1000))) {
      throw new Problem(429, "Too many attempts. Try again in a few minutes.");
    }
    const user = email ? findByEmail(email) : null;
    const good = await checkPassword(password.slice(0, 128), user && user.passwordHash ? user.passwordHash : DUMMY_HASH);
    if (!user || !user.passwordHash || !user.profileCompletedAt || !good) {
      throw new Problem(401, "Incorrect email or password. If you have not created an account yet, continue with Google first.");
    }
    return send(req, res, 200, { status: "signed_in", user: publicUser(user) }, { "Set-Cookie": startSession(req, user.id, body.remember === true) });
  }

  throw new Problem(404, "Endpoint not found");
}

/**
 * Call first from the HTTP handler. Returns true when the request was an /api/auth request (and has been answered).
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse} res
 * @param {string} pathname
 */
function handle(req, res, pathname) {
  if (!pathname.startsWith("/api/auth/")) return false;
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return true;
  }
  route(req, res, pathname).catch((e) => {
    if (e instanceof Problem) return send(req, res, e.status, { error: e.message });
    console.error("[auth] unexpected error:", e);
    send(req, res, 500, { error: "Something went wrong. Please try again." });
  });
  return true;
}

module.exports = {
  handle,
  Problem,
  send,
  corsHeadersFor: corsHeaders,
  currentUser,
  isAdmin,
  /** Local testing: fake accounts (no password, cannot sign in) so the admin charts have something to show. */
  seedDemoUsers(list) {
    for (const x of list) {
      const id = crypto.randomUUID();
      db.users[id] = { id, email: x.email, name: x.name, phone: x.phone, passwordHash: "", googleSub: "", createdAt: x.createdAt, profileCompletedAt: x.createdAt, demo: true };
    }
    save();
  },
  clearDemoUsers() {
    for (const id of Object.keys(db.users)) if (db.users[id].demo) delete db.users[id];
    save();
  },
  /** Every account, without password hashes or session data. */
  listUsers() {
    return Object.values(db.users).map((u) => ({
      demo: !!u.demo,
      id: u.id, email: u.email, name: u.name || "", phone: u.phone || "", createdAt: u.createdAt,
      profileComplete: !!u.profileCompletedAt, hasPassword: !!u.passwordHash, google: !!u.googleSub,
    }));
  },
  allowedOrigins: ALLOWED_ORIGINS,
  limited,
  clientIp,
  /** Lets the license server tell the account page which license keys were bought with an email. */
  setLicenseLookup(fn) {
    licensesFor = fn;
  },
};
