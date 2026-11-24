// Runs after "npm run build": writes the accounts API address (PUBLIC_API_URL) into dist/_headers,
// so the sign-in pages are allowed to talk to it. With no address set, the placeholder is simply removed.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const file = "dist/_headers";
if (!existsSync(file)) {
  console.error(`finish-headers: ${file} is missing.`);
  process.exit(1);
}
let origin = "";
const raw = (process.env.PUBLIC_API_URL || "").trim();
if (raw) {
  try {
    origin = new URL(raw).origin;
  } catch {
    console.error(`finish-headers: PUBLIC_API_URL "${raw}" is not a valid address.`);
    process.exit(1);
  }
}
writeFileSync(file, readFileSync(file, "utf8").replaceAll("__API_ORIGIN__", origin));
console.log(origin ? `Headers: sign-in pages may call ${origin}` : "Headers: PUBLIC_API_URL not set, sign-in pages are not connected to an accounts API.");
