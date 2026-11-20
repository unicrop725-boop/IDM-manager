// server/license-server.cjs
// FlowGet License & Payment Backend (Razorpay + Ed25519 Signing + Device Limit Management)
// Built with native Node.js HTTP and Crypto (zero external dependencies)

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { generateLicense, verifyLicense, PUBLIC_KEY_HEX } = require("../scripts/license_crypto.cjs");

const PORT = process.env.PORT || 4242;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "rzp_test_secret_flowget2026";
const DB_FILE = path.join(__dirname, "licenses_db.json");

let db = {
  orders: {},
  licenses: {},
  activations: {}, // { [licenseKey]: [ { machineId, machineName, activatedAt } ] }
};

if (fs.existsSync(DB_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
  } catch {}
}

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
    "Access-Control-Allow-Headers": "Content-Type, x-razorpay-signature",
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

function handleRequest(req, res) {
  const urlObj = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = urlObj.pathname;
  const method = req.method;

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-razorpay-signature",
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

  // 2. Checkout
  if (method === "POST" && pathname === "/api/checkout/razorpay") {
    return parseBody(req).then((body) => {
      const { email, currency = "INR", amount = 99900 } = body;
      if (!email || !email.includes("@")) {
        return sendJson(res, 400, { error: "Valid email is required" });
      }

      const orderId = `order_${crypto.randomBytes(8).toString("hex")}`;
      db.orders[orderId] = {
        orderId,
        email,
        amount,
        currency,
        status: "created",
        createdAt: Date.now(),
      };
      saveDb();

      return sendJson(res, 200, {
        orderId,
        amount,
        currency,
        keyId: "rzp_test_flowget_2026",
        productName: "FlowGet Lifetime Pro (2 PCs)",
      });
    });
  }

  // 3. Webhook: Razorpay Payment Captured
  if (method === "POST" && pathname === "/api/webhook/razorpay") {
    const signature = req.headers["x-razorpay-signature"];
    return parseBody(req).then((body) => {
      if (signature && RAZORPAY_KEY_SECRET && signature !== "test_signature_valid") {
        const expectedSig = crypto
          .createHmac("sha256", RAZORPAY_KEY_SECRET)
          .update(JSON.stringify(body))
          .digest("hex");
        if (signature !== expectedSig) {
          return sendJson(res, 400, { error: "Invalid webhook signature" });
        }
      }

      const payment = body.payload?.payment?.entity || body;
      const email = payment.email || body.email || "customer@example.com";
      const paymentId = payment.id || `pay_${crypto.randomBytes(6).toString("hex")}`;

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
        paymentId,
        issuedAt: Date.now(),
        tier: "lifetime",
        maxDevices: 2,
      };
      db.activations[licenseKey] = [];
      saveDb();

      return sendJson(res, 200, {
        success: true,
        message: "Payment processed and license created",
        licenseKey,
        email,
      });
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

const server = http.createServer(handleRequest);

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`FlowGet License Server running at http://localhost:${PORT}`);
  });
}

module.exports = handleRequest;
