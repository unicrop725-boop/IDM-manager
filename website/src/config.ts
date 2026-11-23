/**
 * The one place for the website's facts and links. Edit here, then redeploy.
 */
export const SITE = {
  name: "FlowGet",
  tagline: "Downloads that don't give up",
  description:
    "FlowGet is a fast download manager for Windows. It splits files across many connections, resumes after any interruption, and takes over downloads from Chrome, Edge and Brave.",
  language: "en",

  // Release details (shown on the download page and in structured data).
  version: "1.0.0",
  fileSize: "", // e.g. "42 MB" (leave empty to hide)
  sha256: "", // SHA-256 of the installer (leave empty to hide)

  // Where "Download" buttons go: a direct link to the installer, or your releases page.
  downloadUrl: "https://github.com/unicrop725-boop/IDM-manager/releases/latest",
  // Chrome Web Store / Edge Add-ons page. Leave empty until it is published.
  extensionUrl: "",
  // Checkout page. While empty, "Buy" buttons open an email to the support address.
  buyUrl: "",
  supportEmail: "support@flowget.net",

  // Price (one paid plan, no free trial).
  priceUsd: "19.99",
  priceInr: "999",

  // Default picture for sharing links (1200x630, in /public).
  ogImage: "/img/og.png",
  // Name shown as the author of blog posts when a post does not set one.
  defaultAuthor: "FlowGet Team",
} as const;

export const buyHref = (): string =>
  SITE.buyUrl || `mailto:${SITE.supportEmail}?subject=${encodeURIComponent("FlowGet Pro")}`;
