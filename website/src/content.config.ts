import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

/**
 * Blog posts are Markdown files in src/content/blog/. See README.md ("Writing a blog post").
 * The fields below become the page title, description, share card and search-engine data.
 */
const blog = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/blog" }),
  schema: z.object({
    // Shown as the page heading and in search results (aim for 50-60 characters).
    title: z.string().min(10).max(110),
    // Shown under the title in search results and on cards (aim for 120-160 characters).
    description: z.string().min(50).max(200),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    author: z.string().optional(),
    // Used for the tag pages and "related posts". Lower-case words, e.g. ["speed", "windows"].
    tags: z.array(z.string()).default([]),
    // Optional share/cover picture: a path in /public, e.g. "/img/blog/my-post.webp" (1200x630 is ideal).
    cover: z.string().optional(),
    coverAlt: z.string().optional(),
    // true = not published. A date in the future also keeps the post hidden until the next build after that date.
    draft: z.boolean().default(false),
    // Show first on the blog page.
    featured: z.boolean().default(false),
    // Questions and answers at the end of the post. Also sent to search engines as FAQ data.
    faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
  }),
});

export const collections = { blog };
