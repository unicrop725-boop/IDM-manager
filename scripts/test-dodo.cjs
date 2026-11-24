// scripts/test-dodo.cjs: checkout + signed webhook + refund handling, against a fake Dodo API. Run: node scripts/test-dodo.cjs
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const http = require("http");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { Readable } = require("stream");

const SECRET = "whsec_" + crypto.randomBytes(24).toString("base64");
const ORIGIN = "http://localhost:4321";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fg-dodo-"));

let lastDodoRequest = null;
const fakeDodo = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    lastDodoRequest = { url: req.url, auth: req.headers.authorization, body: JSON.parse(b || "{}") };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ session_id: "cks_test", checkout_url: "https://checkout.dodopayments.com/session/cks_test" }));
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
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    r.on("error", reject);
    r.end(data);
  });
}
const jsonHdr = { "Content-Type": "application/json", Origin: ORIGIN };
const plainJson = { "Content-Type": "application/json" };
function signed(id, payload, tsOffset = 0) {
  const raw = JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000) + tsOffset);
  const sig = crypto.createHmac("sha256", Buffer.from(SECRET.slice(6), "base64")).update(`${id}.${ts}.${raw}`).digest("base64");
  return { raw, headers: { "Content-Type": "application/json", "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": "v1," + sig } };
}

(async () => {
  await new Promise((r) => fakeDodo.listen(0, "127.0.0.1", r));
  Object.assign(process.env, {
    DODO_API_KEY: "sk_test_abc",
    DODO_PRODUCT_ID: "pdt_flowget",
    DODO_WEBHOOK_SECRET: SECRET,
    DODO_API_BASE: `http://127.0.0.1:${fakeDodo.address().port}`,
    ALLOWED_ORIGINS: ORIGIN,
    SITE_URL: "https://flowget.net",
    LICENSES_DB: path.join(tmp, "licenses.json"),
    ACCOUNTS_DB: path.join(tmp, "accounts.json"),
  });
  const handler = require("../server/license-server.cjs");
  const { verifyLicense } = require("./license_crypto.cjs");
  const api = http.createServer(handler);
  await new Promise((r) => api.listen(0, "127.0.0.1", r));
  const A = `http://127.0.0.1:${api.address().port}`;

  console.log("Dodo Payments");
  let orderId = "";
  let key = "";
  const post = (p, s) => call(A, "POST", p, { raw: s.raw, headers: s.headers });

  await test("checkout refuses unknown origins, non-JSON and bad emails", async () => {
    assert.strictEqual((await call(A, "POST", "/api/checkout", { body: { email: "a@b.co" }, headers: { ...plainJson, Origin: "https://evil.example" } })).status, 403);
    assert.strictEqual((await call(A, "POST", "/api/checkout", { raw: "email=a@b.co", headers: { "Content-Type": "text/plain", Origin: ORIGIN } })).status, 415);
    assert.strictEqual((await call(A, "POST", "/api/checkout", { body: { email: "nope" }, headers: jsonHdr })).status, 400);
  });

  await test("checkout creates a Dodo session and returns its URL", async () => {
    const r = await call(A, "POST", "/api/checkout", { body: { email: "Buyer@Example.com", name: "Bea Buyer" }, headers: jsonHdr });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.checkoutUrl, "https://checkout.dodopayments.com/session/cks_test");
    assert(/^ord_[a-f0-9]{32}$/.test(r.body.orderId));
    orderId = r.body.orderId;
    assert.strictEqual(lastDodoRequest.url, "/checkouts");
    assert.strictEqual(lastDodoRequest.auth, "Bearer sk_test_abc");
    assert.deepStrictEqual(lastDodoRequest.body.product_cart, [{ product_id: "pdt_flowget", quantity: 1 }]);
    assert.strictEqual(lastDodoRequest.body.customer.email, "buyer@example.com");
    assert.strictEqual(lastDodoRequest.body.return_url, `https://flowget.net/thanks/?order=${orderId}`);
    assert.strictEqual(lastDodoRequest.body.metadata.order_id, orderId);
  });

  await test("CORS preflight only opens for the website", async () => {
    const ok = await call(A, "OPTIONS", "/api/checkout", { headers: { Origin: ORIGIN } });
    assert.strictEqual(ok.status, 204);
    assert.strictEqual(ok.headers["access-control-allow-origin"], ORIGIN);
    const bad = await call(A, "OPTIONS", "/api/checkout", { headers: { Origin: "https://evil.example" } });
    assert.strictEqual(bad.headers["access-control-allow-origin"], undefined);
  });

  await test("status is pending before payment, and unknown orders are 404", async () => {
    const r = await call(A, "GET", "/api/checkout/status?order=" + orderId);
    assert.deepStrictEqual(r.body, { status: "pending" });
    assert.strictEqual((await call(A, "GET", "/api/checkout/status?order=ord_" + "0".repeat(32))).status, 404);
    assert.strictEqual((await call(A, "GET", "/api/checkout/status?order=../x")).status, 404);
  });

  const pay = (id, extra = {}) => ({
    type: "payment.succeeded",
    data: { payment_id: id, customer: { email: "buyer@example.com", name: "Bea" }, metadata: { order_id: orderId }, ...extra },
  });

  await test("webhook rejects missing, forged, stale and altered-body signatures", async () => {
    const p = pay("pay_1");
    assert.strictEqual((await call(A, "POST", "/api/webhook/dodo", { raw: JSON.stringify(p), headers: plainJson })).status, 401);
    const s = signed("evt_a", p);
    assert.strictEqual((await call(A, "POST", "/api/webhook/dodo", { raw: s.raw, headers: { ...s.headers, "webhook-signature": "v1,AAAAAAAA" } })).status, 401);
    const stale = signed("evt_b", p, -3600);
    assert.strictEqual((await post("/api/webhook/dodo", stale)).status, 401);
    const tampered = signed("evt_c", p);
    assert.strictEqual((await call(A, "POST", "/api/webhook/dodo", { raw: tampered.raw.replace("pay_1", "pay_2"), headers: tampered.headers })).status, 401);
    assert.deepStrictEqual((await call(A, "GET", "/api/checkout/status?order=" + orderId)).body, { status: "pending" });
  });

  await test("a signed payment.succeeded creates a valid license for that order", async () => {
    const r = await post("/api/webhook/dodo", signed("evt_1", pay("pay_1")));
    assert.strictEqual(r.status, 200);
    const st = (await call(A, "GET", "/api/checkout/status?order=" + orderId)).body;
    assert.strictEqual(st.status, "paid");
    key = st.licenseKey;
    const v = verifyLicense(key);
    assert.strictEqual(v.valid, true);
    assert.strictEqual(v.payload.email, "buyer@example.com");
    assert.strictEqual(v.payload.maxDevices, 2);
  });

  await test("replayed webhooks and a repeated payment id do not create a second license", async () => {
    const count = () => Object.keys(JSON.parse(fs.readFileSync(process.env.LICENSES_DB, "utf8")).licenses).length;
    const before = count();
    assert.strictEqual((await post("/api/webhook/dodo", signed("evt_1", pay("pay_1")))).body.duplicate, true);
    assert.strictEqual((await post("/api/webhook/dodo", signed("evt_1b", pay("pay_1")))).status, 200);
    assert.strictEqual(count(), before);
  });

  await test("the license activates; other event types are ignored", async () => {
    const r = await call(A, "POST", "/api/license/activate", { body: { licenseKey: key, machineId: "PC-1" }, headers: plainJson });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual((await post("/api/webhook/dodo", signed("evt_other", { type: "subscription.active", data: { payment_id: "pay_x" } }))).status, 200);
  });

  await test("a partial refund keeps the license, a full refund revokes it", async () => {
    await post("/api/webhook/dodo", signed("evt_pr", { type: "refund.succeeded", data: { payment_id: "pay_1", is_partial: true } }));
    assert.strictEqual((await call(A, "POST", "/api/license/activate", { body: { licenseKey: key, machineId: "PC-2" }, headers: plainJson })).status, 200);

    assert.strictEqual((await post("/api/webhook/dodo", signed("evt_fr", { type: "refund.succeeded", data: { payment_id: "pay_1", is_partial: false } }))).status, 200);
    assert.strictEqual((await call(A, "POST", "/api/license/activate", { body: { licenseKey: key, machineId: "PC-3" }, headers: plainJson })).status, 403);
    assert.strictEqual((await call(A, "GET", "/api/license/status/" + encodeURIComponent(key))).body.valid, false);
    assert.deepStrictEqual((await call(A, "GET", "/api/checkout/status?order=" + orderId)).body, { status: "refunded" });
  });

  await test("without a configured secret the webhook is closed (503)", async () => {
    for (const k of Object.keys(require.cache)) if (/server[\\/]dodo\.cjs$/.test(k)) delete require.cache[k];
    const saved = process.env.DODO_WEBHOOK_SECRET;
    delete process.env.DODO_WEBHOOK_SECRET;
    const { createHandler } = require("../server/dodo.cjs");
    process.env.DODO_WEBHOOK_SECRET = saved;
    const h = createHandler({ db: {}, saveDb() {}, issueLicense() { return ""; }, allowedOrigins: [ORIGIN], limited: () => false, clientIp: () => "x" });
    let status = 0;
    const req = Object.assign(new Readable({ read() { this.push("{}"); this.push(null); } }), { method: "POST", headers: {} });
    await new Promise((resolve) => {
      h(req, { writeHead(c) { status = c; }, end: resolve }, "/api/webhook/dodo", new URL("http://x/api/webhook/dodo"));
    });
    assert.strictEqual(status, 503);
  });

  console.log(`\n${passed} passed`);
  api.close();
  fakeDodo.close();
  fs.rmSync(tmp, { recursive: true, force: true });
})();
