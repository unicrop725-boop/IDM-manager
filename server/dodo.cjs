// server/dodo.cjs
// Dodo Payments for FlowGet Pro: start a hosted checkout, then turn the signed "payment succeeded" webhook into a license.
// Zero dependencies (Node crypto + global fetch, Node 18+).
//
// Routes:
//   POST /api/checkout            { email, name? }  -> { checkoutUrl, orderId }   (website calls this, then redirects the buyer)
//   GET  /api/checkout/status?order=ord_...         -> { status: "pending" | "paid", licenseKey? }   (the thank-you page polls this)
//   POST /api/webhook/dodo        Dodo -> us. Standard Webhooks signature required; creates the license.
//
// Environment:
//   DODO_API_KEY         API key from Dodo dashboard > Developer > API Keys
//   DODO_PRODUCT_ID      id of the one-time "FlowGet Pro" product (pdt_...)
//   DODO_WEBHOOK_SECRET  signing secret of the webhook endpoint (whsec_...)
//   DODO_ENV             "live" or "test" (default test)
//   SITE_URL             public website address used for the return page (default: first https origin of ALLOWED_ORIGINS)

"use strict";

const crypto = require("crypto");

const API_KEY = process.env.DODO_API_KEY || "";
const PRODUCT_ID = process.env.DODO_PRODUCT_ID || "";
const WEBHOOK_SECRET = process.env.DODO_WEBHOOK_SECRET || "";
const DODO_BASE = process.env.DODO_API_BASE || (process.env.DODO_ENV === "live" ? "https://live.dodopayments.com" : "https://test.dodopayments.com"); // DODO_API_BASE: tests only
const TOLERANCE_S = 5 * 60;
const MAX_WEBHOOK_BYTES = 1024 * 1024;

class Problem extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ---------------- Standard Webhooks signature (what Dodo uses) ---------------- */
/**
 * @param {string} secret   "whsec_<base64>"
 * @param {Record<string,string|string[]|undefined>} headers   lower-case header names
 * @param {string} rawBody  the body exactly as received
 * @param {number} [nowMs]
 * @returns {boolean}
 */
function verifyWebhook(secret, headers, rawBody, nowMs = Date.now()) {
  const one = (v) => (Array.isArray(v) ? v[0] : v) || "";
  const id = one(headers["webhook-id"]);
  const ts = one(headers["webhook-timestamp"]);
  const sigHeader = one(headers["webhook-signature"]);
  if (!secret || !id || !ts || !sigHeader) return false;
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(nowMs / 1000 - tsNum) > TOLERANCE_S) return false;
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const expected = crypto.createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest();
  for (const part of sigHeader.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    const got = Buffer.from(sig, "base64");
    if (got.length === expected.length && crypto.timingSafeEqual(got, expected)) return true;
  }
  return false;
}

/* ---------------- helpers ---------------- */
function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Problem(413, "Request too large."));
        if (req.destroy) req.destroy();
        return;
      }
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const cleanEmail = (v) => {
  const e = String(v || "").trim().toLowerCase();
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : "";
};
const cleanName = (v) => String(v || "").replace(/\s+/g, " ").trim().slice(0, 80);

/**
 * @param {{
 *   db: any, saveDb: () => void,
 *   issueLicense: (o: {email: string, paymentId: string, accountEmail?: string}) => string,
 *   allowedOrigins: string[], limited: (k: string, max: number, ms: number) => boolean, clientIp: (req: any) => string,
 * }} ctx
 */
function createHandler(ctx) {
  const { db, saveDb, issueLicense, allowedOrigins, limited, clientIp } = ctx;
  db.orders ||= {};
  db.payments ||= {};
  db.webhooks ||= {};

  const siteUrl = () =>
    (process.env.SITE_URL || allowedOrigins.find((o) => o.startsWith("https://")) || allowedOrigins[0] || "https://flowget.net").replace(/\/$/, "");

  function cors(req) {
    const origin = String(req.headers.origin || "").replace(/\/$/, "");
    const h = { Vary: "Origin" };
    if (origin && allowedOrigins.includes(origin)) {
      h["Access-Control-Allow-Origin"] = origin;
      h["Access-Control-Allow-Headers"] = "Content-Type";
      h["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
      h["Access-Control-Max-Age"] = "600";
    }
    return h;
  }
  function send(req, res, status, data) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...cors(req),
    });
    res.end(JSON.stringify(data));
  }

  /* ---- start a checkout ---- */
  async function createCheckout(req, res) {
    const origin = String(req.headers.origin || "").replace(/\/$/, "");
    if (!allowedOrigins.includes(origin)) throw new Problem(403, "This website is not allowed to start a payment.");
    if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) throw new Problem(415, "Expected JSON.");
    if (limited("checkout:" + clientIp(req), 10, 15 * 60 * 1000)) throw new Problem(429, "Too many attempts. Try again in a few minutes.");

    const body = JSON.parse((await readRaw(req, 8 * 1024)) || "{}");
    const email = cleanEmail(body.email);
    if (!email) throw new Problem(400, "Enter a valid email address. Your license key is linked to it.");
    const name = cleanName(body.name) || email.split("@")[0];
    if (!API_KEY || !PRODUCT_ID) throw new Problem(503, "Online payment is not set up yet. Please contact support.");

    const orderId = "ord_" + crypto.randomBytes(16).toString("hex");
    let r;
    try {
      r = await fetch(DODO_BASE + "/checkouts", {
        method: "POST",
        headers: { Authorization: "Bearer " + API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          product_cart: [{ product_id: PRODUCT_ID, quantity: 1 }],
          customer: { email, name },
          return_url: `${siteUrl()}/thanks/?order=${orderId}`,
          metadata: { order_id: orderId, account_email: email },
        }),
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      console.error("[dodo] could not reach Dodo Payments:", e.message);
      throw new Problem(502, "Could not reach the payment service. Please try again.");
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.checkout_url) {
      console.error("[dodo] checkout creation failed:", r.status, JSON.stringify(j).slice(0, 500));
      throw new Problem(502, "Could not start the payment. Please try again or contact support.");
    }

    db.orders[orderId] = { orderId, email, name, status: "created", sessionId: j.session_id || "", createdAt: Date.now() };
    saveDb();
    return send(req, res, 200, { checkoutUrl: j.checkout_url, orderId });
  }

  /* ---- thank-you page asks whether the webhook has arrived ---- */
  function checkoutStatus(req, res, urlObj) {
    if (limited("status:" + clientIp(req), 90, 5 * 60 * 1000)) throw new Problem(429, "Too many requests.");
    const id = urlObj.searchParams.get("order") || "";
    const order = /^ord_[a-f0-9]{32}$/.test(id) ? db.orders[id] : null;
    if (!order) throw new Problem(404, "Order not found.");
    if (order.licenseKey && !order.revoked) return send(req, res, 200, { status: "paid", licenseKey: order.licenseKey, email: order.paymentEmail || order.email });
    if (order.revoked) return send(req, res, 200, { status: "refunded" });
    return send(req, res, 200, { status: "pending" });
  }

  /* ---- Dodo -> us ---- */
  async function webhook(req, res) {
    if (!WEBHOOK_SECRET) throw new Problem(503, "Webhook secret is not configured.");
    const raw = await readRaw(req, MAX_WEBHOOK_BYTES);
    if (!verifyWebhook(WEBHOOK_SECRET, req.headers, raw)) throw new Problem(401, "Invalid webhook signature.");

    const webhookId = String(req.headers["webhook-id"]);
    if (db.webhooks[webhookId]) return send(req, res, 200, { ok: true, duplicate: true });

    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      throw new Problem(400, "Invalid payload.");
    }
    const data = event.data || {};
    const paymentId = String(data.payment_id || "");

    if (event.type === "payment.succeeded" && paymentId) {
      if (!db.payments[paymentId]) {
        const meta = data.metadata || {};
        const order = typeof meta.order_id === "string" ? db.orders[meta.order_id] : null;
        const paymentEmail = cleanEmail(data.customer && data.customer.email) || (order && order.email) || "";
        if (!paymentEmail) throw new Problem(400, "Payment has no customer email.");
        const accountEmail = (order && order.email) || cleanEmail(meta.account_email) || paymentEmail;
        const licenseKey = issueLicense({ email: paymentEmail, paymentId, accountEmail });
        const amount = Number(data.total_amount);
        const currency = typeof data.currency === "string" ? data.currency.toUpperCase().slice(0, 3) : "";
        db.payments[paymentId] = { licenseKey, orderId: order ? order.orderId : "", at: Date.now(), email: paymentEmail, amount: Number.isFinite(amount) ? amount : 0, currency };
        if (order) Object.assign(order, { status: "paid", paymentId, paymentEmail, licenseKey, paidAt: Date.now() });
      }
    } else if ((event.type === "refund.succeeded" && data.is_partial !== true) || event.type === "dispute.lost") {
      const p = db.payments[paymentId];
      if (p) {
        const lic = db.licenses[p.licenseKey];
        if (lic) lic.revoked = true;
        const order = p.orderId && db.orders[p.orderId];
        if (order) order.revoked = true;
      }
    }

    db.webhooks[webhookId] = Date.now();
    const ids = Object.keys(db.webhooks);
    if (ids.length > 2000) for (const k of ids.slice(0, ids.length - 1000)) delete db.webhooks[k];
    saveDb();
    return send(req, res, 200, { ok: true });
  }

  /** Returns true when the request belonged to this module (and is being answered). */
  return function handle(req, res, pathname, urlObj) {
    const isCheckout = pathname === "/api/checkout" || pathname === "/api/checkout/status";
    const isWebhook = pathname === "/api/webhook/dodo";
    if (!isCheckout && !isWebhook) return false;
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors(req));
      res.end();
      return true;
    }
    let job;
    try {
      if (isWebhook && req.method === "POST") job = webhook(req, res);
      else if (pathname === "/api/checkout" && req.method === "POST") job = createCheckout(req, res);
      else if (pathname === "/api/checkout/status" && req.method === "GET") job = Promise.resolve(checkoutStatus(req, res, urlObj));
      else throw new Problem(405, "Method not allowed.");
    } catch (e) {
      job = Promise.reject(e);
    }
    job.catch((e) => {
      if (e instanceof Problem) return send(req, res, e.status, { error: e.message });
      console.error("[dodo] unexpected error:", e);
      send(req, res, 500, { error: "Something went wrong. Please try again." });
    });
    return true;
  };
}

module.exports = { createHandler, verifyWebhook };
