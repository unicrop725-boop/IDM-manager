// Draws the blog cover pictures (1200x630) in the FlowGet colours and saves them to public/img/blog/.
// Run: node scripts/make-covers.mjs   (needs the "sharp" package, which Astro already installs)
// One illustration per article slug. Keep the key shapes inside x 170..1030 so the 3:2 crop on blog cards keeps them.
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const INK = "#0F0F12";
const INK2 = "#16161A";
const LINE = "#2A2A32";
const AMBER = "#FED24F";
const LIME = "#B2D959";
const GREEN = "#7EC151";
const FONT = "Segoe UI, Arial, Helvetica, sans-serif";

const defs = `
  <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${AMBER}"/><stop offset=".55" stop-color="${LIME}"/><stop offset="1" stop-color="${GREEN}"/></linearGradient>
  <linearGradient id="brandH" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${AMBER}"/><stop offset=".55" stop-color="${LIME}"/><stop offset="1" stop-color="${GREEN}"/></linearGradient>
  <linearGradient id="bgA" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFE9A6"/><stop offset=".6" stop-color="#E4F0B0"/><stop offset="1" stop-color="#BFE0A0"/></linearGradient>
  <linearGradient id="bgB" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#9FD478"/><stop offset=".6" stop-color="#C8E27F"/><stop offset="1" stop-color="#F6E27A"/></linearGradient>
  <linearGradient id="bgC" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1C1C22"/><stop offset="1" stop-color="#0A0A0C"/></linearGradient>
  <linearGradient id="bgD" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#CFE9A8"/><stop offset="1" stop-color="#8FCB6E"/></linearGradient>
  <linearGradient id="bgF" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFD982"/><stop offset="1" stop-color="#F3E9B0"/></linearGradient>
  <linearGradient id="bgG" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C9E58A"/><stop offset="1" stop-color="#FBE9A0"/></linearGradient>
  <filter id="soft" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#000" flood-opacity=".28"/></filter>
`;

const blobs = (c = "#fff", o = 0.14) =>
  `<circle cx="140" cy="90" r="210" fill="${c}" opacity="${o}"/><circle cx="1090" cy="560" r="260" fill="${c}" opacity="${o}"/><circle cx="1010" cy="60" r="90" fill="${c}" opacity="${o * 0.8}"/>`;

const covers = {
  // Gauge with a low needle
  "why-is-my-download-so-slow": `
    <rect width="1200" height="630" fill="url(#bgA)"/>${blobs()}
    <rect x="300" y="85" width="600" height="460" rx="44" fill="${INK}" filter="url(#soft)"/>
    <path d="M450 380 A150 150 0 0 1 750 380" fill="none" stroke="${LINE}" stroke-width="30" stroke-linecap="round"/>
    <path d="M450 380 A150 150 0 0 1 511.8 258.6" fill="none" stroke="url(#brandH)" stroke-width="30" stroke-linecap="round"/>
    <line x1="600" y1="380" x2="535" y2="291" stroke="#fff" stroke-width="9" stroke-linecap="round"/>
    <circle cx="600" cy="380" r="19" fill="#fff"/><circle cx="600" cy="380" r="8" fill="${INK}"/>
    <text x="600" y="475" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="46" fill="#fff">3.2 MB/s</text>
    <g fill="${LINE}"><rect x="360" y="505" width="480" height="8" rx="4"/></g><rect x="360" y="505" width="130" height="8" rx="4" fill="url(#brandH)"/>`,

  // Progress bar that breaks and carries on
  "how-to-resume-a-broken-download": `
    <rect width="1200" height="630" fill="url(#bgB)"/>${blobs()}
    <rect x="230" y="200" width="740" height="290" rx="44" fill="#fff" filter="url(#soft)"/>
    <rect x="285" y="305" width="630" height="46" rx="23" fill="#E8ECEF"/>
    <rect x="285" y="305" width="290" height="46" rx="23" fill="url(#brandH)"/>
    <g stroke="${INK}" stroke-width="5" stroke-linecap="round"><line x1="598" y1="288" x2="612" y2="368"/></g>
    <g fill="${GREEN}" opacity=".55"><circle cx="650" cy="328" r="6"/><circle cx="682" cy="328" r="6"/><circle cx="714" cy="328" r="6"/><circle cx="746" cy="328" r="6"/></g>
    <rect x="285" y="395" width="170" height="14" rx="7" fill="#E8ECEF"/><rect x="475" y="395" width="110" height="14" rx="7" fill="#E8ECEF"/>
    <circle cx="600" cy="200" r="62" fill="${INK}" filter="url(#soft)"/>
    <path d="M585 172 L632 200 L585 228 Z" fill="${LIME}"/>`,

  // A chain with a broken link and a 403 badge
  "download-link-expired-403-error-fix": `
    <rect width="1200" height="630" fill="url(#bgC)"/>
    <circle cx="1020" cy="120" r="260" fill="${AMBER}" opacity=".10"/><circle cx="170" cy="560" r="230" fill="${GREEN}" opacity=".10"/>
    <rect x="450" y="125" width="300" height="84" rx="26" fill="${AMBER}"/>
    <text x="600" y="184" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="56" fill="${INK}">403</text>
    <rect x="260" y="290" width="270" height="120" rx="60" fill="none" stroke="${AMBER}" stroke-width="26"/>
    <rect x="670" y="290" width="270" height="120" rx="60" fill="none" stroke="${LIME}" stroke-width="26"/>
    <g stroke="#fff" stroke-width="10" stroke-linecap="round"><line x1="560" y1="300" x2="585" y2="270"/><line x1="610" y1="330" x2="640" y2="330"/><line x1="560" y1="400" x2="585" y2="430"/><line x1="615" y1="372" x2="640" y2="392"/></g>
    <path d="M640 505 a42 42 0 1 1 -12 -30" fill="none" stroke="url(#brandH)" stroke-width="14" stroke-linecap="round"/>
    <path d="M610 462 L640 470 L626 498 Z" fill="${LIME}"/>`,

  // Shield with a tick between two files
  "how-to-check-a-downloaded-file-is-safe": `
    <rect width="1200" height="630" fill="url(#bgD)"/>${blobs()}
    <g filter="url(#soft)"><rect x="205" y="215" width="150" height="190" rx="22" fill="#fff" opacity=".92" transform="rotate(-8 280 310)"/><rect x="845" y="215" width="150" height="190" rx="22" fill="#fff" opacity=".92" transform="rotate(8 920 310)"/></g>
    <g fill="#D9E3DA"><rect x="230" y="262" width="95" height="12" rx="6" transform="rotate(-8 280 310)"/><rect x="230" y="292" width="70" height="12" rx="6" transform="rotate(-8 280 310)"/><rect x="875" y="262" width="95" height="12" rx="6" transform="rotate(8 920 310)"/><rect x="875" y="292" width="70" height="12" rx="6" transform="rotate(8 920 310)"/></g>
    <path d="M600 90 L790 162 V312 C790 420 710 492 600 535 C490 492 410 420 410 312 V162 Z" fill="${INK}" filter="url(#soft)"/>
    <path d="M600 128 L758 188 V312 C758 400 692 462 600 500 C508 462 442 400 442 312 V188 Z" fill="url(#brand)"/>
    <polyline points="528,318 585,375 684,252" fill="none" stroke="${INK}" stroke-width="32" stroke-linecap="round" stroke-linejoin="round"/>`,

  // Stream segments joined into one file
  "download-hls-m3u8-dash-mpd-video-streams": `
    <rect width="1200" height="630" fill="url(#bgC)"/>
    <circle cx="180" cy="90" r="240" fill="${LIME}" opacity=".09"/><circle cx="1050" cy="580" r="260" fill="${AMBER}" opacity=".10"/>
    <text x="215" y="170" font-family="Consolas, 'Courier New', monospace" font-size="30" fill="#9A9AA4">stream.m3u8  ·  manifest.mpd</text>
    ${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${215 + i * 128}" y="205" width="108" height="76" rx="18" fill="${[AMBER, LIME, GREEN][i % 3]}"/>`).join("")}
    ${[0, 1, 2, 3, 4, 5].map((i) => `<path d="M${269 + i * 128} 305 v38" stroke="#5A5A64" stroke-width="6" stroke-linecap="round"/><path d="M${256 + i * 128} 332 l13 14 l13 -14" fill="none" stroke="#5A5A64" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`).join("")}
    <rect x="215" y="385" width="740" height="110" rx="30" fill="url(#brandH)"/>
    <circle cx="283" cy="440" r="34" fill="${INK}"/><path d="M272 422 L302 440 L272 458 Z" fill="${LIME}"/>
    <rect x="345" y="428" width="420" height="14" rx="7" fill="${INK}" opacity=".55"/><rect x="345" y="452" width="260" height="10" rx="5" fill="${INK}" opacity=".3"/>
    <text x="905" y="452" text-anchor="end" font-family="${FONT}" font-weight="800" font-size="34" fill="${INK}">.mp4</text>`,

  // Week of bars with a speed limit line and a clock
  "limit-download-speed-by-time-of-day-windows": `
    <rect width="1200" height="630" fill="url(#bgF)"/>${blobs()}
    <rect x="230" y="110" width="740" height="410" rx="44" fill="#fff" filter="url(#soft)"/>
    ${[170, 235, 140, 260, 205, 110, 85].map((h, i) => `<rect x="${290 + i * 90}" y="${470 - h}" width="56" height="${h}" rx="16" fill="${i === 3 ? "url(#brand)" : "#E9EDF0"}"/>`).join("")}
    <line x1="270" y1="330" x2="930" y2="330" stroke="${INK}" stroke-width="5" stroke-dasharray="4 14" stroke-linecap="round"/>
    <circle cx="880" cy="150" r="66" fill="${INK}" filter="url(#soft)"/>
    <circle cx="880" cy="150" r="46" fill="none" stroke="url(#brandH)" stroke-width="12"/>
    <path d="M880 120 V152 L902 166" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`,

  // One thin browser bar against many parallel segments
  "download-manager-vs-browser-downloads": `
    <rect width="1200" height="630" fill="url(#bgG)"/>${blobs()}
    <g filter="url(#soft)"><rect x="190" y="120" width="390" height="390" rx="40" fill="#fff"/><rect x="620" y="120" width="390" height="390" rx="40" fill="${INK}"/></g>
    <text x="230" y="185" font-family="${FONT}" font-weight="700" font-size="30" fill="${INK}">Browser</text>
    <text x="660" y="185" font-family="${FONT}" font-weight="700" font-size="30" fill="#fff">FlowGet</text>
    <rect x="230" y="305" width="310" height="22" rx="11" fill="#E8ECEF"/><rect x="230" y="305" width="150" height="22" rx="11" fill="#9AA3AB"/>
    <text x="230" y="380" font-family="${FONT}" font-size="26" fill="#7A828A">1 connection</text>
    ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect x="660" y="${222 + i * 33}" width="310" height="18" rx="9" fill="${LINE}"/><rect x="660" y="${222 + i * 33}" width="${[250, 210, 285, 190, 270, 230, 300, 220][i]}" height="18" rx="9" fill="url(#brandH)"/>`).join("")}
    <text x="660" y="505" font-family="${FONT}" font-size="26" fill="#A1A1AA" opacity="0">8 connections</text>`,
};

mkdirSync("public/img/blog", { recursive: true });
for (const [slug, body] of Object.entries(covers)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><defs>${defs}</defs>${body}</svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 88, mozjpeg: true }).toFile(`public/img/blog/${slug}.jpg`);
  console.log("wrote public/img/blog/" + slug + ".jpg");
}
