import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import { readdirSync, readFileSync } from "node:fs";

// The address the site is published at. Change it here once (or set SITE_URL when building).
const site = process.env.SITE_URL || "https://boltgrab.online";

// <lastmod> for the blog: a post's own date (updatedDate, else pubDate), and for the blog index and
// tag pages the newest date among the posts they list. Other pages get no lastmod on purpose:
// a made-up date is worse for crawlers than none.
const blogDir = new URL("./src/content/blog/", import.meta.url);
const frontField = (text, name) => text.match(new RegExp(`^${name}:\\s*"?([^"\\n]+?)"?\\s*$`, "m"))?.[1];
const posts = readdirSync(blogDir)
  .filter((f) => /\.mdx?$/.test(f))
  .map((f) => {
    const text = readFileSync(new URL(f, blogDir), "utf8");
    const tags = [...(text.match(/^tags:\s*\[(.*)\]\s*$/m)?.[1] || "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const date = new Date(frontField(text, "updatedDate") || frontField(text, "pubDate"));
    return { id: f.replace(/\.mdx?$/, ""), tags, date, draft: frontField(text, "draft") === "true" };
  })
  .filter((p) => !p.draft && !Number.isNaN(p.date.getTime()) && p.date.getTime() <= Date.now());
const newest = (list) => (list.length ? new Date(Math.max(...list.map((p) => p.date.getTime()))) : undefined);
const tagSlug = (t) => t.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function lastmodFor(pathname) {
  let m;
  if ((m = pathname.match(/^\/blog\/([^/]+)\/$/)) && posts.some((p) => p.id === m[1])) return posts.find((p) => p.id === m[1]).date;
  if ((m = pathname.match(/^\/blog\/tag\/([^/]+)\/$/))) return newest(posts.filter((p) => p.tags.some((t) => tagSlug(t) === m[1])));
  if (/^\/blog\/(\d+\/)?$/.test(pathname)) return newest(posts);
  return undefined;
}

export default defineConfig({
  site,
  // One canonical address per page: /features/ (never /features or /features.html).
  trailingSlash: "always",
  build: {
    format: "directory",
  },
  compressHTML: true,
  // Sign-in, account and admin pages are private: keep them out of the sitemap (admin/login included).
  // Tag pages are noindex (thin, near-duplicates of the blog index), so they are not listed either.
  integrations: [
    sitemap({
      filter: (page) => !/\/(signin|signup|account|buy|thanks|admin(\/login)?)\/$/.test(page) && !/\/blog\/tag\//.test(page),
      serialize(item) {
        const d = lastmodFor(new URL(item.url).pathname);
        if (d) item.lastmod = d.toISOString();
        return item;
      },
    }),
  ],
});
