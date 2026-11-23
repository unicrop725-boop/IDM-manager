import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// The address the site is published at. Change it here once (or set SITE_URL when building).
const site = process.env.SITE_URL || "https://flowget.net";

export default defineConfig({
  site,
  // One canonical address per page: /features/ (never /features or /features.html).
  trailingSlash: "always",
  build: {
    format: "directory",
  },
  compressHTML: true,
  integrations: [sitemap()],
});
