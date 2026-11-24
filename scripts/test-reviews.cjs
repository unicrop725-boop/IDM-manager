// scripts/test-reviews.cjs: customer reviews (who may write, moderation, what the public sees). Run: node scripts/test-reviews.cjs
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const http = require("http");
const os = require("os");
const path = require("path");
const fs = require("fs");

const ORIGIN = "http://localhost:4321";
const SECRET = "whsec_" + crypto.randomBytes(24).toString("base64");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fg-reviews-"));

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
  Object.assign(process.env, {
    ADMIN_EMAILS: "boss@example.com",
    ALLOWED_ORIGINS: ORIGIN,
    AUTH_DEV_GOOGLE: "1",
    DODO_WEBHOOK_SECRET: SECRET,
    LICENSES_DB: path.join(tmp, "licenses.json"),
    ACCOUNTS_DB: path.join(tmp, "accounts.json"),
  });
  const handler = require("../server/license-server.cjs");
  const api = http.createServer(handler);
  await new Promise((r) => api.listen(0, "127.0.0.1", r));
  const A = `http://127.0.0.1:${api.address().port}`;
  const J = { "Content-Type": "application/json", Origin: ORIGIN };
  const as = (cookie) => ({ headers: { ...J, Cookie: cookie } });

  async function signUp(email, name) {
    const g = await call(A, "POST", "/api/auth/google", { body: { credential: `dev:${email}|${name}` }, headers: J });
    const done = await call(A, "POST", "/api/auth/complete", { body: { setupToken: g.body.setupToken, name, phone: "+919876543210", password: "Passw0rd123" }, headers: J });
    return String(done.headers["set-cookie"][0]).split(";")[0];
  }
  const boss = await signUp("boss@example.com", "Boss Person");
  const buyer = await signUp("jane@example.com", "Jane Marie Doe");
  const other = await signUp("sam@example.com", "Sam Smith");

  // Jane buys FlowGet through the signed webhook.
  const raw = JSON.stringify({ type: "payment.succeeded", data: { payment_id: "pay_rv_1", total_amount: 1999, currency: "USD", customer: { email: "jane@example.com" }, metadata: {} } });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.createHmac("sha256", Buffer.from(SECRET.slice(6), "base64")).update(`evt_rv1.${ts}.${raw}`).digest("base64");
  await call(A, "POST", "/api/webhook/dodo", { raw, headers: { "Content-Type": "application/json", "webhook-id": "evt_rv1", "webhook-timestamp": ts, "webhook-signature": "v1," + sig } });

  const review = { rating: 5, text: "Resumed a huge download after my connection dropped. Worked perfectly and saved me hours.", role: "Video editor" };

  console.log("Reviews");

  await test("the public list starts empty and needs no sign-in", async () => {
    const r = await call(A, "GET", "/api/reviews", { headers: { Origin: ORIGIN } });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.reviews, []);
  });

  await test("only signed-in buyers can write: anonymous 401, non-buyer 403", async () => {
    assert.strictEqual((await call(A, "GET", "/api/reviews/mine", { headers: { Origin: ORIGIN } })).status, 401);
    assert.strictEqual((await call(A, "POST", "/api/reviews", { body: review, headers: { ...J } })).status, 401);
    assert.strictEqual((await call(A, "POST", "/api/reviews", { ...as(other), body: review })).status, 403);
    assert.strictEqual((await call(A, "GET", "/api/reviews/mine", as(other))).body.canReview, false);
    assert.strictEqual((await call(A, "GET", "/api/reviews/mine", as(buyer))).body.canReview, true);
  });

  await test("a review is validated, and other websites cannot post one", async () => {
    assert.strictEqual((await call(A, "POST", "/api/reviews", { ...as(buyer), body: { ...review, rating: 6 } })).status, 400);
    assert.strictEqual((await call(A, "POST", "/api/reviews", { ...as(buyer), body: { ...review, rating: 0 } })).status, 400);
    assert.strictEqual((await call(A, "POST", "/api/reviews", { ...as(buyer), body: { ...review, text: "too short" } })).status, 400);
    const evil = await call(A, "POST", "/api/reviews", { headers: { "Content-Type": "application/json", Origin: "https://evil.example", Cookie: buyer }, body: review });
    assert.strictEqual(evil.status, 403);
  });

  await test("a new review waits for approval and is not public yet", async () => {
    const r = await call(A, "POST", "/api/reviews", { ...as(buyer), body: review });
    assert.strictEqual(r.status, 200, r.text);
    assert.strictEqual(r.body.status, "pending");
    assert.deepStrictEqual((await call(A, "GET", "/api/reviews", { headers: { Origin: ORIGIN } })).body.reviews, []);
    const mine = (await call(A, "GET", "/api/reviews/mine", as(buyer))).body;
    assert.strictEqual(mine.review.status, "pending");
    assert.strictEqual(mine.review.rating, 5);
    assert.strictEqual((await call(A, "GET", "/api/admin/me", as(boss))).body.pendingReviews, 1);
  });

  await test("moderation is admin-only", async () => {
    assert.strictEqual((await call(A, "GET", "/api/admin/reviews", as(buyer))).status, 403);
    assert.strictEqual((await call(A, "POST", "/api/admin/reviews", { ...as(buyer), body: { id: "x", action: "approve" } })).status, 403);
    const list = (await call(A, "GET", "/api/admin/reviews", as(boss))).body.rows;
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].email, "jane@example.com");
    assert.strictEqual(list[0].status, "pending");
  });

  await test("an approved review is public, with a short name and no email", async () => {
    const id = (await call(A, "GET", "/api/admin/reviews", as(boss))).body.rows[0].id;
    assert.strictEqual((await call(A, "POST", "/api/admin/reviews", { ...as(boss), body: { id, action: "approve" } })).status, 200);
    const r = await call(A, "GET", "/api/reviews", { headers: { Origin: ORIGIN } });
    assert.strictEqual(r.body.reviews.length, 1);
    const v = r.body.reviews[0];
    assert.strictEqual(v.name, "Jane D.");
    assert.strictEqual(v.role, "Video editor");
    assert.strictEqual(v.rating, 5);
    assert.strictEqual(v.verified, true);
    assert(!r.text.includes("jane@example.com") && !r.text.includes("Marie") && !r.text.includes("Doe"), "no email or full surname");
  });

  await test("editing a published review sends it back to pending", async () => {
    const r = await call(A, "POST", "/api/reviews", { ...as(buyer), body: { ...review, rating: 4, text: review.text + " Updated after a month of use." } });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual((await call(A, "GET", "/api/reviews", { headers: { Origin: ORIGIN } })).body.reviews, []);
    assert.strictEqual((await call(A, "GET", "/api/reviews/mine", as(buyer))).body.review.status, "pending");
  });

  await test("rejecting hides it, deleting removes it, a refunded buyer cannot write", async () => {
    const id = (await call(A, "GET", "/api/admin/reviews", as(boss))).body.rows[0].id;
    await call(A, "POST", "/api/admin/reviews", { ...as(boss), body: { id, action: "approve" } });
    await call(A, "POST", "/api/admin/reviews", { ...as(boss), body: { id, action: "reject" } });
    assert.deepStrictEqual((await call(A, "GET", "/api/reviews", { headers: { Origin: ORIGIN } })).body.reviews, []);
    assert.strictEqual((await call(A, "POST", "/api/admin/reviews", { ...as(boss), body: { id, action: "explode" } })).status, 400);
    assert.strictEqual((await call(A, "POST", "/api/admin/reviews", { ...as(boss), body: { id, action: "delete" } })).status, 200);
    assert.strictEqual((await call(A, "GET", "/api/admin/reviews", as(boss))).body.rows.length, 0);
    const keyId = (await call(A, "GET", "/api/admin/purchases", as(boss))).body.rows[0].keyId;
    await call(A, "POST", "/api/admin/license", { ...as(boss), body: { keyId, revoked: true } });
    assert.strictEqual((await call(A, "POST", "/api/reviews", { ...as(buyer), body: review })).status, 403);
  });

  await test("demo data includes sample reviews and removes them again", async () => {
    await call(A, "POST", "/api/admin/demo", { ...as(boss), body: { action: "seed" } });
    const pub = (await call(A, "GET", "/api/reviews", { headers: { Origin: ORIGIN } })).body.reviews;
    assert(pub.length >= 3, "demo reviews are published");
    await call(A, "POST", "/api/admin/demo", { ...as(boss), body: { action: "clear" } });
    assert.deepStrictEqual((await call(A, "GET", "/api/reviews", { headers: { Origin: ORIGIN } })).body.reviews, []);
  });

  console.log(`\n${passed} passed`);
  api.close();
  fs.rmSync(tmp, { recursive: true, force: true });
})();
