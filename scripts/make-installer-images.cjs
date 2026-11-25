// Draws the Windows installer's branded pictures and saves them as the 24-bit BMP files NSIS needs:
//   src-tauri/installer/sidebar.bmp  164 x 314  (welcome + finish pages)
//   src-tauri/installer/header.bmp   150 x 57   (the other pages)
// Needs Chrome (any recent install) and puppeteer-core (already a dev dependency).
// Run: node scripts/make-installer-images.cjs   (set CHROME_PATH if Chrome is somewhere unusual)
"use strict";
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "src-tauri", "installer");
const iconB64 = fs.readFileSync(path.join(root, "src-tauri", "icons", "icon.png")).toString("base64");
const fontB64 = fs.readFileSync(path.join(root, "node_modules", "@fontsource-variable", "outfit", "files", "outfit-latin-wght-normal.woff2")).toString("base64");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

// 24-bit BMP, rows bottom-up and padded to 4 bytes, from RGBA pixels (alpha already flattened).
function bmp24(w, h, rgba) {
  const rowBytes = Math.ceil((w * 3) / 4) * 4;
  const size = 54 + rowBytes * h;
  const b = Buffer.alloc(size);
  b.write("BM", 0);
  b.writeUInt32LE(size, 2);
  b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14);
  b.writeInt32LE(w, 18);
  b.writeInt32LE(h, 22);
  b.writeUInt16LE(1, 26);
  b.writeUInt16LE(24, 28);
  b.writeUInt32LE(rowBytes * h, 34);
  b.writeInt32LE(2835, 38);
  b.writeInt32LE(2835, 42);
  for (let y = 0; y < h; y++) {
    const dst = 54 + (h - 1 - y) * rowBytes;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      b[dst + x * 3] = rgba[s + 2];
      b[dst + x * 3 + 1] = rgba[s + 1];
      b[dst + x * 3 + 2] = rgba[s];
    }
  }
  return b;
}

// Everything is drawn at 4x and shrunk, so edges and text come out smooth.
const PAGE = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Outfit;src:url(data:font/woff2;base64,${fontB64}) format("woff2");font-weight:100 900}
body{margin:0;background:#000}</style><body><script>
const icon = new Image(); icon.src = "data:image/png;base64,${iconB64}";
const S = 4;
const BG = "#0E1013", LIME = "#B2D959", AMBER = "#F5B942";

function base(ctx, w, h) {
  ctx.fillStyle = BG; ctx.fillRect(0, 0, w, h);
  // soft brand glows
  let g = ctx.createRadialGradient(w * 0.15, h * 0.05, 0, w * 0.15, h * 0.05, h * 0.75);
  g.addColorStop(0, "rgba(245,185,66,0.30)"); g.addColorStop(1, "rgba(245,185,66,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  g = ctx.createRadialGradient(w * 0.95, h * 1.0, 0, w * 0.95, h * 1.0, h * 0.8);
  g.addColorStop(0, "rgba(178,217,89,0.34)"); g.addColorStop(1, "rgba(178,217,89,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

// the app's flowing lines, drawn as a few smooth curves
function flow(ctx, w, h, n, alpha, top, span) {
  ctx.lineWidth = 1.2 * S / 4 * 2;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1 || 1);
    ctx.strokeStyle = "hsla(" + (60 + t * 40) + ",70%,62%," + (alpha * (0.5 + 0.5 * t)) + ")";
    ctx.beginPath();
    for (let x = -4; x <= w + 4; x += 3) {
      const y = h * (top + t * span) + Math.sin(x / w * 5.2 + t * 2.4) * h * 0.045 + Math.sin(x / w * 11 + t * 5) * h * 0.012;
      x === -4 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function roundedIcon(ctx, x, y, size) {
  ctx.save();
  ctx.shadowColor = "rgba(178,217,89,0.45)"; ctx.shadowBlur = size * 0.35; ctx.shadowOffsetY = size * 0.06;
  ctx.drawImage(icon, x, y, size, size);
  ctx.restore();
}

function draw(kind) {
  const w = kind === "sidebar" ? 164 : 150, h = kind === "sidebar" ? 314 : 57;
  const big = document.createElement("canvas"); big.width = w * S; big.height = h * S;
  const c = big.getContext("2d"); c.scale(S, S);
  base(c, w, h);
  if (kind === "sidebar") {
    flow(c, w, h, 6, 0.55, 0.77, 0.19);
    roundedIcon(c, (w - 84) / 2, 42, 84);
    c.textAlign = "center"; c.textBaseline = "alphabetic";
    c.fillStyle = "#FFFFFF"; c.font = "700 30px Outfit"; c.fillText("FlowGet", w / 2, 172);
    c.fillStyle = LIME; c.font = "600 10.5px Outfit"; c.fillText("DOWNLOAD MANAGER", w / 2, 192);
    c.fillStyle = "rgba(255,255,255,0.72)"; c.font = "400 11px Outfit";
    c.fillText("Fast. Smart. Resumable.", w / 2, 212);
    // a thin accent line
    const lg = c.createLinearGradient(w * 0.25, 0, w * 0.75, 0); lg.addColorStop(0, AMBER); lg.addColorStop(1, LIME);
    c.fillStyle = lg; c.fillRect(w * 0.25, 222, w * 0.5, 2);
  } else {
    flow(c, w, h, 3, 0.5, 0.8, 0.14);
    roundedIcon(c, 10, 8.5, 40);
    c.textAlign = "left"; c.textBaseline = "alphabetic";
    c.fillStyle = "#FFFFFF"; c.font = "700 21px Outfit"; c.fillText("FlowGet", 58, 31);
    c.fillStyle = LIME; c.font = "600 8px Outfit"; c.fillText("DOWNLOAD MANAGER", 59, 43);
  }
  // shrink to the real size
  const out = document.createElement("canvas"); out.width = w; out.height = h;
  const o = out.getContext("2d"); o.imageSmoothingEnabled = true; o.imageSmoothingQuality = "high";
  o.drawImage(big, 0, 0, w, h);
  const d = o.getImageData(0, 0, w, h).data;
  let bin = ""; for (let i = 0; i < d.length; i++) bin += String.fromCharCode(d[i]);
  return { w, h, b64: btoa(bin) };
}
window.render = async () => { await icon.decode(); await document.fonts.load("700 30px Outfit"); await document.fonts.load("400 11px Outfit"); return { sidebar: draw("sidebar"), header: draw("header") }; };
</script>`;

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-first-run"] });
  try {
    const page = await browser.newPage();
    await page.setContent(PAGE);
    const res = await page.evaluate(() => window.render());
    for (const [name, r] of [["sidebar", res.sidebar], ["header", res.header]]) {
      const rgba = Buffer.from(r.b64, "base64");
      const file = path.join(outDir, name + ".bmp");
      fs.writeFileSync(file, bmp24(r.w, r.h, rgba));
      console.log(`wrote ${path.relative(root, file)}  ${r.w}x${r.h}`);
    }
  } finally {
    await browser.close();
  }
})();
