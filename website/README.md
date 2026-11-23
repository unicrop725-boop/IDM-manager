# FlowGet website and blog

Built with **Astro**: it turns the pages and your Markdown blog posts into plain, fast HTML files. That output is
what Cloudflare serves. No server code runs, which is the best case for speed, security and search ranking.

## Why this stack

| Need | How it is met |
|---|---|
| Ranks well in search | Real HTML for every page (no JavaScript needed to read it), one canonical address per page, unique titles and descriptions, structured data (Organization, SoftwareApplication, FAQ, BlogPosting, Breadcrumbs), sitemap, RSS, fast load |
| Hosted on Cloudflare | Static output goes straight to **Cloudflare Pages**, free tier is enough. No adapter needed |
| You can add blog posts | Drop a Markdown file into `src/content/blog/`. No database, no admin panel to maintain or secure |
| Easy to keep | One small JavaScript file in the whole site (the mobile menu) |

**Why not Next.js?** Next.js is a good framework for web apps. For a marketing site plus blog it adds a lot of
JavaScript and, on Cloudflare, an extra adapter to run. Astro gives the same SEO features with less to maintain.
If you ever need accounts or a dashboard on the same site, we can add that part with Cloudflare Workers.

## Deploy on Cloudflare Pages

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**, and choose the repository.
2. Settings:
   - **Root directory:** `website`
   - **Framework preset:** Astro
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Environment variable:** `NODE_VERSION` = `22` (and, if your domain is not `flowget.net`, `SITE_URL` = `https://your-domain`)
3. Save and deploy. Every push to `main` publishes again.
4. **Custom domain:** the project → **Custom domains** → add your domain. In Cloudflare **Rules → Redirect Rules** add
   `www.yourdomain` → `https://yourdomain` (301), so there is one address for the site.

## Writing a blog post

1. Run `npm run new-post "Your article title"` inside this folder (or copy an existing file in `src/content/blog/`).
2. Edit the new file. The top (between the `---` lines) holds the settings:

   | Field | What it does |
   |---|---|
   | `title` | The heading and the title in search results (about 50-60 characters works best) |
   | `description` | The text under the title in search results (120-160 characters) |
   | `pubDate` | Publish date. A date in the future keeps the post hidden until the first build after that date |
   | `updatedDate` | Set it when you improve an old post. It is shown and sent to search engines |
   | `tags` | Topics, e.g. `["speed", "windows"]`. A tag gets its own page when two posts share it |
   | `cover` | Optional share picture, e.g. `/img/blog/my-post.webp` (put the file in `public/img/blog/`, 1200x630) |
   | `faq` | Optional questions and answers shown at the end and sent to search engines |
   | `draft` | `true` hides the post. Remove it or set `false` to publish |

3. Write the article under the second `---` in Markdown: `##` for sections (they become the table of contents),
   `-` for lists, `[text](/features/)` for links, `![alt text](/img/blog/picture.webp)` for pictures.
4. Commit and push. Cloudflare builds and publishes it. Check it locally first with `npm run dev`.

### What makes a post rank

- Answer one clear question per post, and answer it in the first two sentences.
- Use the words people search for in the title and the first heading, naturally.
- Be useful and accurate: no padding. Long enough to be complete (800+ words), not longer.
- Link to related posts and to the features page with descriptive link text.
- Add pictures with descriptive `alt` text and a width and height.
- Update old posts and set `updatedDate`.
- Posts that have a `faq` can show extra answers in search results.

## Before launch

| What | Where |
|---|---|
| Domain, installer link, version, SHA-256, extension store link, checkout link, support email, price | `src/config.ts` (the only file for these) |
| Your domain for canonical links and the sitemap | `astro.config.mjs` (or set `SITE_URL` when building) |
| Privacy wording | `src/pages/privacy.astro` is a draft: check it against your final product and local law |
| The Windows SmartScreen note | `src/pages/download.astro` and the FAQ in `src/pages/index.astro`: remove once the installer is code-signed |
| Screenshots | `public/img/app-*.webp` are the app with sample data; replace them when the interface changes |

## After launch: getting found

Search engines need time. A new site normally takes weeks to start ranking and months to reach its level, and no
one can promise a position. What helps most, in order:

1. Add the site to **Google Search Console** and **Bing Webmaster Tools**, and submit `https://your-domain/sitemap-index.xml`.
2. Publish a new useful post every week or two, and improve the ones that start to get impressions.
3. Get real links: your GitHub repository, the Chrome Web Store listing, Product Hunt, Reddit and forum answers where the posts truly help.
4. Watch Search Console for which questions bring people in, then write more about those.
5. If you schedule posts with future dates, add a Cloudflare **Deploy hook** and call it daily so they appear on time.

## Colours

The brand colours are the variables at the top of `public/css/global.css` (`--purple`, `--teal`, `--sky`, `--green`,
`--amber`, `--grad`): amber #FED24F, yellow #FFF449, lime #B2D959 and green #7EC151. Change them there and the whole site follows.

## Commands

```
npm install        once, to download the tools
npm run dev        live preview at http://localhost:4321
npm run build      creates the finished site in dist/ (and checks that the stylesheet and sitemap are there)
npm run preview    serves dist/ locally
npm run new-post   creates a new blog post file
```

## Files

```
src/config.ts            links, prices, release details
src/content/blog/        the blog posts (Markdown)
src/pages/               the pages: home, features, download, privacy, blog, switch-from-idm, 404, rss.xml, robots.txt
src/layouts/Base.astro   the page frame, search-engine tags and structured data
src/components/          header, footer, post cards
public/css/global.css    all styling (colours are the variables at the top)
public/                  files copied as they are: stylesheet, images, font, _headers (security and caching)
```

Security note: `npm audit` reports advisories in Astro 6 that are fixed only in Astro 7. They concern server-side
rendering, `define:vars`, spread attributes and image processing of untrusted files, none of which this static
site uses. Upgrade to Astro 7 when you move to Node 22.23.4 or newer.
