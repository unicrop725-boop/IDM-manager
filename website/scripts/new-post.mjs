// Usage: npm run new-post "My article title"
// Creates src/content/blog/<slug>.md with the front matter filled in, as a draft.
import { writeFileSync, existsSync } from "node:fs";

const title = process.argv.slice(2).join(" ").trim();
if (!title) {
  console.error('Give the post a title, for example: npm run new-post "How to speed up downloads"');
  process.exit(1);
}
const slug = title
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 70);
const file = new URL(`../src/content/blog/${slug}.md`, import.meta.url);
if (existsSync(file)) {
  console.error(`A post named ${slug}.md already exists.`);
  process.exit(1);
}
const now = new Date().toISOString();
writeFileSync(
  file,
  `---
title: ${JSON.stringify(title)}
description: "Write 120 to 160 characters that explain what the reader will learn. This is what search results show."
pubDate: ${now}
tags: ["downloads"]
draft: true # change to false (or delete this line) to publish
# updatedDate: ${now}
# cover: "/img/blog/${slug}.webp"
# faq:
#   - q: "A question readers ask?"
#     a: "A short, direct answer."
---

Start with the answer or the problem in the first two sentences.

## First heading

Write in short paragraphs. Use headings (##) for each section: they become the table of contents.

## Second heading

Link to other posts and pages, for example [features](/features/).
`,
);
console.log(`Created src/content/blog/${slug}.md (a draft). Edit it, then set draft: false.`);
