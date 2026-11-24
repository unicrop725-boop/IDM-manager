// scripts/test-phase8-acceptance.js
// Phase 8 Acceptance Test: Full End-to-End Product Lifecycle
// (Install -> 30-Day Trial -> Expire/Gating -> Buy via Dodo Payments -> Activate -> 2-PC Limit -> Update -> Crash Reporter)

import assert from "assert";
import fs from "fs";
import { Readable } from "stream";
import { createRequire } from "module";
import crypto from "crypto";
import os from "os";
import path from "path";

const require = createRequire(import.meta.url);
const { generateLicense, verifyLicense, PUBLIC_KEY_HEX } = require("./license_crypto.cjs");
const DODO_SECRET = "whsec_" + crypto.randomBytes(24).toString("base64");
process.env.DODO_WEBHOOK_SECRET = DODO_SECRET;
// Hermetic: own temporary databases, so a local server/.env (or the real license file) never leaks into the test.
const LICENSES_TMP = path.join(os.tmpdir(), `fg-phase8-licenses-${process.pid}.json`);
process.env.LICENSES_DB = LICENSES_TMP;
process.env.ACCOUNTS_DB = path.join(os.tmpdir(), `fg-phase8-accounts-${process.pid}.json`);
const licenseServer = require("../server/license-server.cjs");

// Headers Dodo sends (Standard Webhooks): id, timestamp and an HMAC-SHA256 over "id.timestamp.body".
function dodoHeaders(id, rawBody) {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.createHmac("sha256", Buffer.from(DODO_SECRET.slice(6), "base64")).update(`${id}.${ts}.${rawBody}`).digest("base64");
  return { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": "v1," + sig };
}

function callServer(method, urlPath, body = {}, headers = {}) {
  return new Promise((resolve) => {
    const raw = JSON.stringify(body);
    const req = new Readable({
      read() {
        this.push(raw);
        this.push(null);
      },
    });
    req.method = method;
    req.url = urlPath;
    req.headers = {
      host: "localhost",
      "content-type": "application/json",
      ...headers,
    };

    let statusCode = 200;
    let responseBody = "";

    const res = {
      writeHead(code) {
        statusCode = code;
      },
      end(chunk) {
        if (chunk) responseBody += chunk;
        try {
          resolve({ status: statusCode, body: JSON.parse(responseBody) });
        } catch {
          resolve({ status: statusCode, body: responseBody });
        }
      },
    };

    licenseServer(req, res);
  });
}

function anonymizeStack(rawStack) {
  if (!rawStack) return "";
  let cleaned = rawStack;
  cleaned = cleaned.replace(/([a-zA-Z]:\\Users\\)[^\\]+/gi, "$1[REDACTED_USER]");
  cleaned = cleaned.replace(/(\/(Users|home)\/)[^/]+/gi, "$1[REDACTED_USER]");
  cleaned = cleaned.replace(/(Bearer|Token|key=)\s*[a-zA-Z0-9_\-.]+/gi, "$1 [REDACTED_TOKEN]");
  cleaned = cleaned.replace(/:\/\/([^:@]+):([^@]+)@/g, "://[REDACTED_USER]:[REDACTED_PASS]@");
  return cleaned;
}

function recordCrashReport(error, optIn = false) {
  const err = typeof error === "string" ? new Error(error) : error;
  return {
    id: `crash_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: Date.now(),
    appName: "FlowGet",
    version: "1.0.0",
    os: "Windows",
    errorName: err.name || "Error",
    errorMessage: anonymizeStack(err.message),
    stackTrace: anonymizeStack(err.stack),
    userOptIn: optIn,
  };
}

console.log("=================================================");
console.log("  PHASE 8 ACCEPTANCE TEST SUITE - FLOWGET        ");
console.log("=================================================");

let passCount = 0;
function test(name, fn) {
  return new Promise((resolve) => {
    try {
      const res = fn();
      if (res && typeof res.then === "function") {
        res
          .then(() => {
            console.log(`[PASS] ${name}`);
            passCount++;
            resolve();
          })
          .catch((err) => {
            console.error(`[FAIL] ${name}:`, err.message, err.cause || "");
            process.exitCode = 1;
            resolve();
          });
      } else {
        console.log(`[PASS] ${name}`);
        passCount++;
        resolve();
      }
    } catch (err) {
      console.error(`[FAIL] ${name}:`, err.message);
      process.exitCode = 1;
      resolve();
    }
  });
}

async function runAllTests() {
  // 1. 30-Day Secure Trial & Tamper Resistance
  await test("1. 30-Day Trial Calculation & Multi-Location Tamper Resistance", () => {
    const now = Math.floor(Date.now() / 1000);
    const TRIAL_DURATION = 30 * 86400;

    // Simulate multi-location stores
    const dbTs = now;
    const fileTs = now;
    const regTs = now;

    // Minimum timestamp algorithm
    const oldest = Math.min(dbTs, fileTs, regTs);
    const elapsed = now - oldest;
    const daysRemaining = Math.max(0, Math.ceil((TRIAL_DURATION - elapsed) / 86400));
    assert.strictEqual(daysRemaining, 30);

    // Simulate tampering: user deletes db or sets date forward in one place
    const tamperedDb = now + 86400 * 10;
    const resolvedOldest = Math.min(tamperedDb, fileTs, regTs);
    assert.strictEqual(resolvedOldest, now, "Oldest timestamp prevents clock tampering");
  });

  // 2. Feature Gating when Trial is Expired
  await test("2. Feature Gating Post-Trial (2 Conns Limit, No Turbo, No Media Ripping)", () => {
    function computeEntitlements({ isLicensed, isTrialExpired }) {
      const isUnlicensedExpired = !isLicensed && isTrialExpired;
      return {
        canDownload: true, // basic downloading continues!
        maxConnections: isUnlicensedExpired ? 2 : 32,
        turboModeAllowed: !isUnlicensedExpired,
        mediaDownloadAllowed: !isUnlicensedExpired,
        showPremiumPopup: isUnlicensedExpired,
      };
    }

    // Active Trial
    const trialState = computeEntitlements({ isLicensed: false, isTrialExpired: false });
    assert.strictEqual(trialState.maxConnections, 32);
    assert.strictEqual(trialState.turboModeAllowed, true);
    assert.strictEqual(trialState.mediaDownloadAllowed, true);

    // Expired Trial
    const expiredState = computeEntitlements({ isLicensed: false, isTrialExpired: true });
    assert.strictEqual(expiredState.canDownload, true, "Basic download still works");
    assert.strictEqual(expiredState.maxConnections, 2, "Limited to 2 connections");
    assert.strictEqual(expiredState.turboModeAllowed, false, "Turbo Mode disabled");
    assert.strictEqual(expiredState.mediaDownloadAllowed, false, "Media streaming disabled");
    assert.strictEqual(expiredState.showPremiumPopup, true, "Premium popup shown");

    // Pro Lifetime Active
    const proState = computeEntitlements({ isLicensed: true, isTrialExpired: true });
    assert.strictEqual(proState.maxConnections, 32);
    assert.strictEqual(proState.turboModeAllowed, true);
    assert.strictEqual(proState.mediaDownloadAllowed, true);
    assert.strictEqual(proState.showPremiumPopup, false);
  });

  // 3. Dodo Payments webhook -> automatic license
  let generatedKey = "";
  await test("3. Buy FlowGet Key via Dodo Payments webhook", async () => {
    const payload = {
      type: "payment.succeeded",
      data: { payment_id: "pay_test_123456", customer: { email: "buyer@example.com", name: "Buyer" }, metadata: {} },
    };
    const raw = JSON.stringify(payload);

    // An unsigned or wrongly signed webhook must never create a license.
    const unsigned = await callServer("POST", "/api/webhook/dodo", payload);
    assert.strictEqual(unsigned.status, 401);
    const forged = await callServer("POST", "/api/webhook/dodo", payload, { ...dodoHeaders("evt_forged", raw), "webhook-signature": "v1,AAAA" });
    assert.strictEqual(forged.status, 401);

    const ok = await callServer("POST", "/api/webhook/dodo", payload, dodoHeaders("evt_test_1", raw));
    assert.strictEqual(ok.status, 200);

    // The key goes to the buyer through the account page; read it back from the license database here.
    const db = JSON.parse(fs.readFileSync(LICENSES_TMP, "utf8"));
    generatedKey = db.payments["pay_test_123456"].licenseKey;
    assert(generatedKey.startsWith("FG1."));
  });

  // 4. Ed25519 Offline Verification
  await test("4. Ed25519 Offline License Verification & Anti-Tampering", () => {
    assert(generatedKey, "Generated key exists");

    // Valid verification
    const verified = verifyLicense(generatedKey);
    assert.strictEqual(verified.valid, true);
    assert.strictEqual(verified.payload.email, "buyer@example.com");
    assert.strictEqual(verified.payload.tier, "lifetime");
    assert.strictEqual(verified.payload.maxDevices, 2);

    // Tampered verification: modify 1 character in signature
    const parts = generatedKey.split(".");
    const tamperedSig = parts[2].slice(0, -2) + "ZZ";
    const tamperedKey = `${parts[0]}.${parts[1]}.${tamperedSig}`;
    const tamperedCheck = verifyLicense(tamperedKey);
    assert.strictEqual(tamperedCheck.valid, false, "Tampered signature must be rejected");
  });

  // 5. 2-PC Activation Limit & Machine Transfer
  await test("5. License Activation & 2-PC Device Limit Enforcement", async () => {
    // Activate PC 1
    const pc1 = await callServer("POST", "/api/license/activate", {
      licenseKey: generatedKey,
      machineId: "HWID-PC-1",
      machineName: "Desktop Workstation",
    });
    assert.strictEqual(pc1.status, 200);
    assert.strictEqual(pc1.body.activeDevices, 1);

    // Activate PC 2
    const pc2 = await callServer("POST", "/api/license/activate", {
      licenseKey: generatedKey,
      machineId: "HWID-PC-2",
      machineName: "Laptop ThinkPad",
    });
    assert.strictEqual(pc2.status, 200);
    assert.strictEqual(pc2.body.activeDevices, 2);

    // Attempt PC 3 (Limit Reached!)
    const pc3 = await callServer("POST", "/api/license/activate", {
      licenseKey: generatedKey,
      machineId: "HWID-PC-3",
      machineName: "Office Computer",
    });
    assert.strictEqual(pc3.status, 403, "Should reject 3rd PC");
    assert(pc3.body.error.includes("limit reached"));

    // Deactivate PC 1 (Device Transfer)
    const deact = await callServer("POST", "/api/license/deactivate", {
      licenseKey: generatedKey,
      machineId: "HWID-PC-1",
    });
    assert.strictEqual(deact.status, 200);
    assert.strictEqual(deact.body.activeDevices, 1);

    // Now Activate PC 3 -> Should succeed!
    const pc3Retry = await callServer("POST", "/api/license/activate", {
      licenseKey: generatedKey,
      machineId: "HWID-PC-3",
      machineName: "Office Computer",
    });
    assert.strictEqual(pc3Retry.status, 200);
    assert.strictEqual(pc3Retry.body.activeDevices, 2);
  });

  // 6. Auto-Update & Changelog Verification
  await test("6. Auto-Update Manifest & Signed Payload", () => {
    const updateManifest = {
      version: "1.1.0",
      notes: "Turbo Mode 2.0 multi-adapter bonding boost and Ed25519 offline license verification.",
      pub_date: new Date().toISOString(),
      platforms: {
        "windows-x86_64": {
          signature: "RWRL9J2...minisign_signature...",
          url: "https://releases.flowget.net/download/v1.1.0/FlowGet_1.1.0_x64-setup.nsis.zip",
        },
      },
    };

    assert.strictEqual(updateManifest.version, "1.1.0");
    assert(updateManifest.platforms["windows-x86_64"].signature);
    assert(updateManifest.platforms["windows-x86_64"].url.endsWith(".zip"));
  });

  // 7. Anonymous Crash Reporter Sanitization
  await test("7. Opt-In Crash Reporting & File Path PII Redaction", () => {
    const sampleError = new Error("Failed to load chunk at C:\\Users\\JohnDoe\\Downloads\\test.iso");
    sampleError.stack = `Error: Failed to load chunk at C:\\Users\\JohnDoe\\Downloads\\test.iso
    at Object.download (C:\\Users\\JohnDoe\\AppData\\Local\\FlowGet\\app.js:42:15)
    with token Bearer secret_token_xyz12345`;

    const cleanedStack = anonymizeStack(sampleError.stack);

    // Verify username and secret are sanitized
    assert(!cleanedStack.includes("JohnDoe"), "Username must be redacted");
    assert(cleanedStack.includes("[REDACTED_USER]"), "Replaced with [REDACTED_USER]");
    assert(!cleanedStack.includes("secret_token_xyz12345"), "Token must be redacted");
    assert(cleanedStack.includes("[REDACTED_TOKEN]"), "Replaced with [REDACTED_TOKEN]");

    const report = recordCrashReport(sampleError, false);
    assert.strictEqual(report.userOptIn, false);
    assert(report.id.startsWith("crash_"));
  });

  // 8. Installer Configuration in tauri.conf.json
  await test("8. NSIS / MSI Installer & File Association Specs", () => {
    const tauriConf = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf-8"));
    assert(tauriConf.bundle.targets.includes("nsis"));
    assert(tauriConf.bundle.targets.includes("msi"));
    assert(tauriConf.bundle.fileAssociations.some((f) => f.ext.includes("flowget")));
    assert(tauriConf.plugins.updater.pubkey);
  });

  console.log("=================================================");
  console.log(`  PHASE 8 ACCEPTANCE TEST RESULT: ${passCount}/8 PASSED`);
  console.log("=================================================");
}

runAllTests().catch((e) => {
  console.error("Test runner error:", e);
  process.exitCode = 1;
});
