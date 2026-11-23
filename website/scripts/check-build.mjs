// Runs after "npm run build". Stops the deployment when the build came out without its stylesheet or pages,
// so an unstyled site can never be published by mistake.
import { existsSync, readFileSync } from "node:fs";

const fail = (msg) => {
  console.error(`\nBuild check failed: ${msg}\nDelete the "dist" folder and run "npm run build" again.`);
  process.exit(1);
};

if (!existsSync("dist/index.html")) fail("dist/index.html is missing.");
if (!existsSync("dist/css/global.css") || readFileSync("dist/css/global.css", "utf8").length < 5000) fail("dist/css/global.css is missing or too small.");
const home = readFileSync("dist/index.html", "utf8");
if (!/<link rel="stylesheet" href="\/css\/global\.css/.test(home)) fail("the home page does not link its stylesheet.");
if (!existsSync("dist/sitemap-index.xml")) fail("the sitemap was not generated.");
console.log("Build check passed: stylesheet present and linked, sitemap present.");
