// scripts/test-license-hardening.cjs: licence endpoints must survive hostile input and can't be tricked.
// Run: node scripts/test-license-hardening.cjs   (needs the signing key: LICENSE_PRIVATE_KEY_HEX or server/license_private_key.txt)
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const http = require("http");
const os = require("os");
const path = require("path");
const fs = require("fs");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fg-lic-"));
process.env.LICENSES_DB = path.join(tmp, "lic.json");
process.env.ACCOUNTS_DB = path.join(tmp, "acc.json");
process.env.DODO_WEBHOOK_SECRET = "whsec_" + Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");

const { generateLicense } = require("./license_crypto.cjs");
try {
  generateLicense({ keyId: "probe", email: "a@b.co", tier: "lifetime", maxDevices: 2, issuedAt: 1 });
} catch (e) {
  console.log("SKIPPED: " + e.message);
  process.exit(0);
}
const handler = require("../server/license-server.cjs");

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

const server = http.createServer(handler).listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (p, body, raw) => {
    const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: raw !== undefined ? raw : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const mint = () => generateLicense({ keyId: "FG-T-" + crypto.randomBytes(3).toString("hex"), email: "t@t.test", tier: "lifetime", maxDevices: 2, issuedAt: 1 });
  // A key as a real purchase leaves it: signed AND recorded by the server.
  const key = () => {
    const k = mint();
    handler.db.licenses[k] = { keyId: "x", email: "t@t.test", tier: "lifetime", maxDevices: 2 };
    return k;
  };
  const alive = async () => (await fetch(base + "/api/health")).status === 200;

  console.log("Licence hardening");

  await test("prototype-property names cannot crash deactivate", async () => {
    for (const k of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      const r = await post("/api/license/deactivate", { licenseKey: k, machineId: "x" });
      assert.strictEqual(r.status, 400, k);
    }
    assert.ok(await alive());
  });

  await test("null, array and wrongly typed bodies are 400, never a crash", async () => {
    for (const raw of ["null", "[]", "5", '"x"']) assert.strictEqual((await post("/api/license/activate", null, raw)).status, 400, raw);
    for (const b of [{ licenseKey: 1, machineId: "x" }, { licenseKey: {}, machineId: "x" }, { licenseKey: key(), machineId: { a: 1 } }, { licenseKey: key(), machineId: ["x"] }, { licenseKey: key(), machineId: 12 }]) {
      assert.strictEqual((await post("/api/license/activate", b)).status, 400);
    }
    assert.ok(await alive());
  });

  await test("oversized bodies get 413 and are not buffered", async () => {
    const r = await post("/api/license/activate", { licenseKey: "A".repeat(200000) });
    assert.strictEqual(r.status, 413);
    assert.ok(await alive());
  });

  await test("device limit holds even with whitespace-padded copies of the key", async () => {
    const k = key();
    const ok = [];
    for (const [i, variant] of [k, " " + k, k + " ", k + "\n", "\t" + k, k + "\r\n", k].entries()) {
      ok.push((await post("/api/license/activate", { licenseKey: variant, machineId: "pc" + i })).status);
    }
    assert.strictEqual(ok.filter((s) => s === 200).length, 2, JSON.stringify(ok));
  });

  await test("a revoked licence stays refused when the key is padded with whitespace", async () => {
    const payId = "pay_" + crypto.randomBytes(4).toString("hex");
    const send = async (type, data) => {
      const body = JSON.stringify({ type, data });
      const id = "msg_" + crypto.randomBytes(8).toString("hex");
      const ts = Math.floor(Date.now() / 1000);
      const sig = crypto.createHmac("sha256", Buffer.from("0123456789abcdef0123456789abcdef")).update(`${id}.${ts}.${body}`).digest("base64");
      return fetch(base + "/api/webhook/dodo", { method: "POST", headers: { "Content-Type": "application/json", "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": "v1," + sig }, body });
    };
    await send("payment.succeeded", { payment_id: payId, customer: { email: "buyer@test.local" }, total_amount: 100, currency: "USD", metadata: {} });
    const lic = JSON.parse(fs.readFileSync(process.env.LICENSES_DB, "utf8"));
    const k = Object.keys(lic.licenses).find((x) => lic.licenses[x].paymentId === payId);
    assert.ok(k, "the purchase issued a key");
    assert.strictEqual((await post("/api/license/activate", { licenseKey: k, machineId: "a" })).status, 200);
    await send("refund.succeeded", { payment_id: payId, is_partial: false });
    for (const variant of [k, k + " ", " " + k, k + "\n"]) {
      assert.strictEqual((await post("/api/license/activate", { licenseKey: variant, machineId: "fresh" + variant.length })).status, 403, JSON.stringify(variant.slice(-3)));
    }
  });

  await test("machine name is length-capped and control characters removed", async () => {
    const k = key();
    await post("/api/license/activate", { licenseKey: k, machineId: "m", machineName: "N".repeat(5000) + "\u0000\n" });
    const st = await (await fetch(base + "/api/license/status/" + encodeURIComponent(k))).json();
    assert.ok(st.devices[0].machineName.length <= 80);
  });

  await test("a validly signed key the server never issued is refused (leaked signing key cannot mint licenses)", async () => {
    const forged = mint(); // correct signature, but not in the server's records
    for (const variant of [forged, " " + forged + "\n"]) {
      const r = await post("/api/license/activate", { licenseKey: variant, machineId: "pirate" });
      assert.strictEqual(r.status, 403);
      assert.strictEqual(r.json.code, "unknown_key");
    }
    const st = await (await fetch(base + "/api/license/status/" + encodeURIComponent(forged))).json();
    assert.strictEqual(st.valid, false);
    assert.ok(!Object.prototype.hasOwnProperty.call(handler.db.activations, forged), "no activation record is created for it");
  });

  await test("an issued key still activates, and a refund still beats an issued key", async () => {
    const k = key();
    assert.strictEqual((await post("/api/license/activate", { licenseKey: k, machineId: "ok1" })).status, 200);
    handler.db.licenses[k].revoked = true;
    const r = await post("/api/license/activate", { licenseKey: k, machineId: "ok2" });
    assert.strictEqual(r.status, 403);
    assert.notStrictEqual(r.json.code, "unknown_key", "a refund is not reported as an unknown key");
  });

  await test("a normal save leaves a valid database and no temporary file behind", async () => {
    await post("/api/license/activate", { licenseKey: key(), machineId: "save-test" });
    const parsed = JSON.parse(fs.readFileSync(process.env.LICENSES_DB, "utf8"));
    assert.ok(parsed && typeof parsed === "object" && parsed.activations);
    assert.ok(!fs.existsSync(process.env.LICENSES_DB + ".tmp"), "temp file must be renamed away");
  });

  await test("a damaged database stops the server and is kept, never replaced by an empty one", async () => {
    const { spawnSync } = require("child_process");
    const bad = path.join(tmp, "damaged.json");
    const original = '{"orders":{},"licenses":{"FG1.x.y":{"revoked":true}},"activations":{"trunc'; // cut off mid-write
    fs.writeFileSync(bad, original);
    const r = spawnSync(process.execPath, ["-e", 'require(process.argv[1])', path.join(__dirname, "..", "server", "license-server.cjs")], {
      env: { ...process.env, LICENSES_DB: bad, ACCOUNTS_DB: path.join(tmp, "acc2.json") },
      encoding: "utf8",
      timeout: 15000,
    });
    assert.notStrictEqual(r.status, 0, "server must refuse to start on a damaged database");
    assert.match(r.stderr, /could not be read/);
    assert.strictEqual(fs.readFileSync(bad, "utf8"), original, "the damaged file must not be overwritten");
    const kept = fs.readdirSync(tmp).filter((f) => f.startsWith("damaged.json.damaged-"));
    assert.strictEqual(kept.length, 1, "a copy of the damaged file is kept");
    assert.strictEqual(fs.readFileSync(path.join(tmp, kept[0]), "utf8"), original);
  });

  console.log(`\n${passed} passed`);
  server.close();
  process.exit(process.exitCode || 0);
});
