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
  } catch {}
}
db.orders ||= {};
db.licenses ||= {};
db.activations ||= {};
db.payments ||= {};
db.webhooks ||= {};
db.reviews ||= {};

function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf-8");
  } catch {}
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

function parseBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

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
    return parseBody(req).then((body) => {
      const { licenseKey, machineId, machineName = "Windows PC" } = body;
      if (!licenseKey || !machineId) {
        return sendJson(res, 400, { error: "licenseKey and machineId are required" });
      }

      const check = verifyLicense(licenseKey);
      if (!check.valid) {
        return sendJson(res, 400, { error: check.error || "Invalid license key signature" });
      }

      if (db.licenses[licenseKey] && db.licenses[licenseKey].revoked) {
        return sendJson(res, 403, { error: "This license was refunded and is no longer valid." });
      }

      if (!db.activations[licenseKey]) {
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
    return parseBody(req).then((body) => {
      const { licenseKey, machineId } = body;
      if (!licenseKey || !machineId) {
        return sendJson(res, 400, { error: "licenseKey and machineId are required" });
      }

      if (db.activations[licenseKey]) {
        db.activations[licenseKey] = db.activations[licenseKey].filter((m) => m.machineId !== machineId);
        saveDb();
      }

      return sendJson(res, 200, {
        success: true,
        message: "Machine deactivated successfully. Slot freed for device transfer.",
        activeDevices: db.activations[licenseKey] ? db.activations[licenseKey].length : 0,
        maxDevices: 2,
      });
    });
  }

  // 6. Status check
  if (method === "GET" && pathname.startsWith("/api/license/status/")) {
    const licenseKey = pathname.replace("/api/license/status/", "");
    const check = verifyLicense(licenseKey);
    if (!check.valid) {
      return sendJson(res, 400, { valid: false, error: check.error });
    }

    if (db.licenses[licenseKey] && db.licenses[licenseKey].revoked) {
      return sendJson(res, 200, { valid: false, error: "This license was refunded." });
    }
    const activeList = db.activations[licenseKey] || [];
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
  server.listen(PORT, () => {
    console.log(`FlowGet License Server running at http://localhost:${PORT}`);
  });
}

module.exports = handleRequest;
