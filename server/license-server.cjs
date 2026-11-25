// server/license-server.cjs
// FlowGet License & Payment Backend (Dodo Payments + Ed25519 Signing + Device Limit Management)
// Built with native Node.js HTTP and Crypto (zero external dependencies)

const http = require("http");
const fs = require("fs");
const path = require("path");

// Optional settings file next to this script (git-ignored): KEY=value per line. Real environment variables win.
try {
  for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    }
  }
} catch {
  /* no .env file */
}

const crypto = require("crypto");
const { generateLicense, verifyLicense, PUBLIC_KEY_HEX } = require("../scripts/license_crypto.cjs");
const auth = require("./auth.cjs");
const dodo = require("./dodo.cjs");
const admin = require("./admin.cjs");
const reviews = require("./reviews.cjs");

const PORT = process.env.PORT || 4242;
const DB_FILE = process.env.LICENSES_DB || path.join(__dirname, "licenses_db.json");

let db = {
  orders: {},
  licenses: {},
  activations: {}, // { [licenseKey]: [ { machineId, machineName, activatedAt } ] }
  payments: {}, // { [dodoPaymentId]: { licenseKey, orderId, at } }
  webhooks: {}, // webhook ids already handled (Dodo retries)
};

if (fs.existsSync(DB_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
  } catch (e) {
    // Never carry on with an EMPTY database in place of a damaged one: the next save would overwrite the file and
    // erase every licence, refund (revoked) flag and device record for good, so refunded keys would work again.
    // Keep a copy of the damaged file and stop, so a person can restore it.
    const keep = `${DB_FILE}.damaged-${Date.now()}`;
    try {
      fs.copyFileSync(DB_FILE, keep);
    } catch {}
    throw new Error(`The licence database ${DB_FILE} could not be read (${e.message}). A copy was kept as ${keep}. Restore or fix the file, then start again.`);
  }
}
db.orders ||= {};
db.licenses ||= {};
db.activations ||= {};
db.payments ||= {};
db.webhooks ||= {};
db.reviews ||= {};

function saveDb() {
  // Write a temporary file, then rename it over the real one. A crash or power cut mid-write can then never leave a
  // half-written database behind (the rename is all-or-nothing).
  const tmp = `${DB_FILE}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf-8");
    fs.renameSync(tmp, DB_FILE);
  } catch (e) {
    console.error(`[licenses] COULD NOT SAVE ${DB_FILE}: ${e && e.message}`);
  }
}

function sendJson(res, statusCode, data) {
  const json = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(json);
}

const MAX_LICENSE_BODY = 8 * 1024; // a licence request is a key (~300 bytes) plus a machine id and name
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/**
 * Reads a small JSON object. Answers 413 / 400 itself and resolves null when the request is not usable,
 * so every handler can simply `if (!body) return;`.
 */
function parseBody(req, res) {
  return new Promise((resolve) => {
    let raw = "";
    let size = 0;
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    req.on("data", (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_LICENSE_BODY) {
        // Stop buffering, answer now, throw away whatever else arrives, and hang up shortly after. (Destroying the
        // socket at once makes the OS reset the connection, and the client never sees the 413.)
        raw = "";
        res.setHeader("Connection", "close");
        sendJson(res, 413, { error: "Request too large." });
        finish(null);
        req.resume();
        setTimeout(() => req.destroy(), 3000).unref();
        return;
      }
      raw += chunk;
    });
    req.on("error", () => finish(null));
    req.on("end", () => {
      let value;
      try {
        value = raw ? JSON.parse(raw) : {};
      } catch {
        value = {};
      }
      // null, arrays, numbers and strings are valid JSON but not a request we understand.
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        sendJson(res, 400, { error: "Expected a JSON object." });
        return finish(null);
      }
      finish(value);
    });
  });
}

/** A licence key as a clean string (surrounding whitespace is never part of a key), or "". */
const cleanKey = (v) => (typeof v === "string" && v.length <= 2048 ? v.trim() : "");
/** A machine id: a short non-empty string, or "". */
const cleanMachineId = (v) => (typeof v === "string" && v.trim().length > 0 && v.length <= 128 ? v.trim() : "");
const cleanMachineName = (v) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80) : "") || "Windows PC";

/** Signs a new lifetime license for a paid order and records it. Returns the key. */
function issueLicense({ email, paymentId, accountEmail }) {
  const keyId = `FG-PRO-${crypto.randomBytes(4).toString("hex").toUpperCase()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const licenseKey = generateLicense({
    keyId,
    email,
    tier: "lifetime",
    maxDevices: 2,
    issuedAt: Math.floor(Date.now() / 1000),
  });
  db.licenses[licenseKey] = {
    keyId,
    email,
    accountEmail: accountEmail || email,
    paymentId,
    issuedAt: Date.now(),
    tier: "lifetime",
    maxDevices: 2,
  };
  db.activations[licenseKey] = [];
  saveDb();
  return licenseKey;
}

const handleDodo = dodo.createHandler({
  db,
  saveDb,
  issueLicense,
  allowedOrigins: auth.allowedOrigins,
  limited: auth.limited,
  clientIp: auth.clientIp,
});

const hasLicense = (email) =>
  Object.values(db.licenses).some((l) => !l.revoked && (String(l.email || "").toLowerCase() === email || String(l.accountEmail || "").toLowerCase() === email));

const handleReviews = reviews.createHandler({ db, saveDb, auth, hasLicense, limited: auth.limited, clientIp: auth.clientIp });

const handleAdmin = admin.createHandler({
  db,
  saveDb,
  auth,
  issueLicense,
  siteUrl: () => (process.env.SITE_URL || auth.allowedOrigins.find((o) => o.startsWith("https://")) || auth.allowedOrigins[0] || "https://flowget.net").replace(/\/$/, ""),
  limited: auth.limited,
  clientIp: auth.clientIp,
});

function handleRequest(req, res) {
  const urlObj = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = urlObj.pathname;
  const method = req.method;

  // Accounts (Google sign-in, profile, password login) have their own CORS rules because they use cookies.
  if (auth.handle(req, res, pathname)) return;

  // Customer reviews (public list, write your own): see server/reviews.cjs
  if (handleReviews(req, res, pathname)) return;

  // Admin panel API (users, purchases, stats, blog): see server/admin.cjs
  if (handleAdmin(req, res, pathname, urlObj)) return;

  // Checkout and payment webhook (Dodo Payments): see server/dodo.cjs
  if (handleDodo(req, res, pathname, urlObj)) return;

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  // 1. Healthcheck
  if (method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, {
      status: "healthy",
      service: "FlowGet License Server",
      publicKey: PUBLIC_KEY_HEX,
      version: "1.0.0",
    });
  }

  // 4. Activate License
  if (method === "POST" && pathname === "/api/license/activate") {
    return parseBody(req, res).then((body) => {
      if (!body) return;
      // Normalised once, then used for every lookup, so " key", "key\n" and "key" are the same licence.
      const licenseKey = cleanKey(body.licenseKey);
      const machineId = cleanMachineId(body.machineId);
      const machineName = cleanMachineName(body.machineName);
      if (!licenseKey || !machineId) {
        return sendJson(res, 400, { error: "licenseKey and machineId are required" });
      }

      const check = verifyLicense(licenseKey);
      if (!check.valid) {
        return sendJson(res, 400, { error: check.error || "Invalid license key signature" });
      }

      // A valid signature only proves the key was made with our signing key, not that WE issued it (the key has been
      // exposed in git history). Only keys recorded when a purchase/admin issue happened are accepted. The distinct
      // code lets the app keep the stored key and recover on its own if this server's database is ever restored.
      if (!own(db.licenses, licenseKey)) {
        return sendJson(res, 403, { error: "This license key was not issued by FlowGet.", code: "unknown_key" });
      }

      if (db.licenses[licenseKey].revoked) {
        return sendJson(res, 403, { error: "This license was refunded and is no longer valid." });
      }

      if (!own(db.activations, licenseKey)) {
        db.activations[licenseKey] = [];
      }

      const existingList = db.activations[licenseKey];
      const alreadyActive = existingList.find((m) => m.machineId === machineId);
      if (alreadyActive) {
        return sendJson(res, 200, {
          success: true,
          message: "Machine already activated",
          activeDevices: existingList.length,
          maxDevices: 2,
          tier: check.payload.tier,
        });
      }

      if (existingList.length >= 2) {
        return sendJson(res, 403, {
          error: "Device limit reached (maximum 2 PCs). Please deactivate an existing PC before activating this machine.",
          activeDevices: existingList.length,
          maxDevices: 2,
        });
      }

      existingList.push({
        machineId,
        machineName,
        activatedAt: Date.now(),
      });
      saveDb();

      return sendJson(res, 200, {
        success: true,
        message: `FlowGet Pro successfully activated on ${machineName}`,
        activeDevices: existingList.length,
        maxDevices: 2,
        tier: check.payload.tier,
        email: check.payload.email,
      });
    });
  }

  // 5. Deactivate License
  if (method === "POST" && pathname === "/api/license/deactivate") {
    return parseBody(req, res).then((body) => {
      if (!body) return;
      const licenseKey = cleanKey(body.licenseKey);
      const machineId = cleanMachineId(body.machineId);
      if (!licenseKey || !machineId) {
        return sendJson(res, 400, { error: "licenseKey and machineId are required" });
      }
      // Only a genuinely signed key can name a record (this also keeps "__proto__" and friends out of the lookups).
      if (!verifyLicense(licenseKey).valid) {
        return sendJson(res, 400, { error: "Invalid license key" });
      }

      if (own(db.activations, licenseKey)) {
        db.activations[licenseKey] = db.activations[licenseKey].filter((m) => m.machineId !== machineId);
        saveDb();
      }

      return sendJson(res, 200, {
        success: true,
        message: "Machine deactivated successfully. Slot freed for device transfer.",
        activeDevices: own(db.activations, licenseKey) ? db.activations[licenseKey].length : 0,
        maxDevices: 2,
      });
    });
  }

  // 6. Status check
  if (method === "GET" && pathname.startsWith("/api/license/status/")) {
    let licenseKey;
    try {
      licenseKey = cleanKey(decodeURIComponent(pathname.replace("/api/license/status/", "")));
    } catch {
      return sendJson(res, 400, { valid: false, error: "Invalid license key" });
    }
    const check = verifyLicense(licenseKey);
    if (!check.valid) {
      return sendJson(res, 400, { valid: false, error: check.error });
    }

    if (!own(db.licenses, licenseKey)) {
      return sendJson(res, 200, { valid: false, error: "This license key was not issued by FlowGet." });
    }
    if (db.licenses[licenseKey].revoked) {
      return sendJson(res, 200, { valid: false, error: "This license was refunded." });
    }
    const activeList = own(db.activations, licenseKey) ? db.activations[licenseKey] : [];
    return sendJson(res, 200, {
      valid: true,
      payload: check.payload,
      activeDevices: activeList.length,
      maxDevices: check.payload.maxDevices || 2,
      devices: activeList,
    });
  }

  return sendJson(res, 404, { error: "Endpoint not found" });
}

// The account page shows the license keys bought with the signed-in email.
auth.setLicenseLookup((email) =>
  Object.entries(db.licenses)
    .filter(([, l]) => !l.revoked && (String(l.email || "").toLowerCase() === email || String(l.accountEmail || "").toLowerCase() === email))
    .map(([licenseKey, l]) => ({ licenseKey, keyId: l.keyId, tier: l.tier, issuedAt: l.issuedAt, maxDevices: l.maxDevices })),
);

const server = http.createServer(handleRequest);

if (require.main === module) {
  // Defence in depth: a bug in one request must never take the licence, account and payment server down for everyone.
  process.on("unhandledRejection", (e) => console.error("[server] unhandled rejection (request survived):", e));
  process.on("uncaughtException", (e) => console.error("[server] uncaught exception (kept running):", e));
  // With the fake Google login on (local testing) the server listens on this PC only. Bound to every network card it
  // would let anyone on the same Wi-Fi sign in as the admin (a forged Origin header is all it takes). HOST overrides.
  const HOST = process.env.HOST || (process.env.AUTH_DEV_GOOGLE === "1" ? "127.0.0.1" : undefined);
  server.listen(PORT, HOST, () => {
    console.log(`FlowGet License Server running at http://${HOST || "localhost"}:${PORT}${HOST ? "" : " (all network interfaces)"}`);
  });
}

module.exports = handleRequest;
// In-process access to the live database, so tests can register keys the way a purchase does. Not reachable over HTTP.
module.exports.db = db;
