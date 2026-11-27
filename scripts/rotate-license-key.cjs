// Generates a NEW Ed25519 licence signing key pair.
//   node scripts/rotate-license-key.cjs
// - writes the private key to server/license_private_key.txt (git-ignored; back it up somewhere safe, it cannot be recovered)
// - prints the public key to paste into BOTH scripts/license_crypto.cjs (PUBLIC_KEY_HEX) and src-tauri/src/licensing.rs (PUBLIC_KEY_HEX)
// Licence keys signed with the OLD key stop working in app builds that contain the NEW public key, so re-issue them
// (and ship the new build) before or together with the switch.
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const target = process.env.LICENSE_PRIVATE_KEY_FILE || path.join(__dirname, "..", "server", "license_private_key.txt");
if (fs.existsSync(target) && !process.argv.includes("--force")) {
  console.error(`${target} already exists. Move it away first, or run again with --force (the old key is then gone for good).`);
  process.exit(1);
}

const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
const priv = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32).toString("hex");
const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");

fs.writeFileSync(target, priv + "\n", { mode: 0o600 });
console.log(`New private key written to ${target}  (keep a backup; never commit it)`);
console.log(`\nNew PUBLIC key (paste into scripts/license_crypto.cjs and src-tauri/src/licensing.rs):\n  ${pub}\n`);
