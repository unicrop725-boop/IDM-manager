// scripts/license_crypto.cjs
// Ed25519 licence keys: signed here (server only), verified offline by the app with the public key below.
//
// The PRIVATE key must never be in the repository or in anything shipped to users. It is read from, in order:
//   1. the LICENSE_PRIVATE_KEY_HEX environment variable (64 hex characters), or
//   2. the file named by LICENSE_PRIVATE_KEY_FILE, or server/license_private_key.txt (git-ignored).
// Verifying a key needs only the public key, so tests and the app never need the private one.
// Generate a new pair with: node scripts/rotate-license-key.cjs
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PUBLIC_KEY_HEX = "ded7e146d3187012e95c8a8913f5be710c6cafd0a741511f6185cf4879a9f796";

function loadPrivateKeyHex() {
  const fromEnv = (process.env.LICENSE_PRIVATE_KEY_HEX || "").trim();
  if (fromEnv) return fromEnv;
  const file = process.env.LICENSE_PRIVATE_KEY_FILE || path.join(__dirname, "..", "server", "license_private_key.txt");
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

function getPrivateKey() {
  const hex = loadPrivateKeyHex();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "The licence signing key is not configured. Set LICENSE_PRIVATE_KEY_HEX, or put the 64-hex-character key in server/license_private_key.txt (never commit it).",
    );
  }
  const pkcs8Prefix = Buffer.from("302e020100300506032b657004220420", "hex");
  const privDer = Buffer.concat([pkcs8Prefix, Buffer.from(hex, "hex")]);
  return crypto.createPrivateKey({ key: privDer, format: "der", type: "pkcs8" });
}

function getPublicKey() {
  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  const pubDer = Buffer.concat([spkiPrefix, Buffer.from(PUBLIC_KEY_HEX, "hex")]);
  return crypto.createPublicKey({ key: pubDer, format: "der", type: "spki" });
}

function generateLicense(payload) {
  const jsonStr = JSON.stringify(payload);
  const payloadB64 = Buffer.from(jsonStr, "utf-8").toString("base64url");
  const priv = getPrivateKey();
  const signature = crypto.sign(null, Buffer.from(payloadB64, "utf-8"), priv);
  const sigB64 = signature.toString("base64url");
  return `FG1.${payloadB64}.${sigB64}`;
}

function verifyLicense(licenseKey) {
  try {
    const parts = licenseKey.trim().split(".");
    if (parts.length !== 3 || parts[0] !== "FG1") return { valid: false, error: "Invalid license format" };
    const payloadB64 = parts[1];
    const sigB64 = parts[2];
    const pub = getPublicKey();
    const verified = crypto.verify(
      null,
      Buffer.from(payloadB64, "utf-8"),
      pub,
      Buffer.from(sigB64, "base64url")
    );
    if (!verified) return { valid: false, error: "Invalid cryptographic signature" };
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
    return { valid: true, payload };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

module.exports = {
  PUBLIC_KEY_HEX,
  generateLicense,
  verifyLicense,
};

if (require.main === module) {
  const testLic = generateLicense({
    keyId: "FG-PRO-LIFETIME-001",
    email: "customer@example.com",
    tier: "lifetime",
    maxDevices: 2,
    issuedAt: Math.floor(Date.now() / 1000),
  });
  console.log("Generated license key:\n", testLic);
  const check = verifyLicense(testLic);
  console.log("Verification result:\n", check);
}
