/**
 * The one place for the website's facts and links. Edit here, then redeploy.
 */
export const SITE = {
  name: "BoltGrab",
  tagline: "Downloads that don't give up",
  description:
    "BoltGrab is a fast download manager for Windows. It splits files across many connections, resumes after any interruption, and takes over downloads from Chrome, Edge and Brave.",
  language: "en",

  // Release details (shown on the download page and in structured data).
  version: "1.0.0",
  fileSize: "11.6 MB", // e.g. "42 MB" (leave empty to hide)
  sha256: "4B4A4D745C2D16493311E1746905AFA3006AAA70240DEFB66E9467CD13B83420", // SHA-256 of the installer (leave empty to hide)

  // Where "Download" buttons go: a direct link to the installer, or your releases page.
  downloadUrl: "/downloads/BoltGrab_1.0.0_x64-setup.exe",
  // Chrome Web Store / Edge Add-ons page, or local .zip download in /public/downloads/.
  extensionUrl: "/downloads/boltgrab-extension.zip",
  // Where "Buy" buttons go. The on-site /buy/ page starts a Dodo Payments checkout (needs PUBLIC_API_URL and the server's DODO_* settings).
  // Set a full URL here to use an external page instead.
  buyUrl: "/buy/",
  supportEmail: "support@boltgrab.online",
  // Address of the accounts API (server/license-server.cjs). Set PUBLIC_API_URL when building, e.g. https://api.boltgrab.online.
  // While empty, the sign-in page says that sign-in is not available yet.
  apiUrl: ((import.meta.env.PUBLIC_API_URL as string | undefined) || "").replace(/\/$/, ""),

  // Price (one paid plan, no free trial).
  priceUsd: "9",

  // Default picture for sharing links (1200x630, in /public).
  ogImage: "/img/og.png",
  // Name shown as the author of blog posts when a post does not set one.
  defaultAuthor: "BoltGrab Team",
  // Shown after the author name on blog cards.
  defaultAuthorRole: "Editorial",
} as const;

export const buyHref = (): string =>
  SITE.buyUrl || `mailto:${SITE.supportEmail}?subject=${encodeURIComponent("BoltGrab Pro")}`;
