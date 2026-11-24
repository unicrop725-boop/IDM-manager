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

## The live demo on the home page

The window on the home page is the real FlowGet UI, built in demo mode (a simulated backend, nothing is downloaded) and served at /app-demo/. It is generated output in public/app-demo/. After changing the app's UI, rebuild it from the app repo root:

    npm run build:demo

Then commit the updated public/app-demo/ folder. The home page embeds it with src/components/Demo.astro and public/js/demo-embed.js.


## Sign-in and accounts

`/signin/`, `/signup/` and `/account/` talk to the accounts API in `server/` (see `server/auth.cjs`). The flow: **Continue with Google**, then the person adds their name, phone number and a password, and after that can sign in with email and password.

Set up once:

1. **Google client ID.** In Google Cloud Console create an OAuth client of type *Web application*. Add your site (for example `https://flowget.net`, and `http://localhost:4321` for local work) under *Authorized JavaScript origins*. No redirect URI is needed.
2. **Run the API** (`node server/license-server.cjs`) somewhere with HTTPS, with:
   - `GOOGLE_CLIENT_ID` – the client ID from step 1
   - `ALLOWED_ORIGINS` – your site's address(es), comma separated (default: flowget.net and local dev)
   - `TRUST_PROXY=1` when it sits behind Cloudflare or another proxy
   - `COOKIE_DOMAIN` – only if the site and API are on different subdomains and you want to share the cookie (for example `.flowget.net`)
3. **Build the site** with `PUBLIC_API_URL=https://api.flowget.net npm run build`. The build also adds that address to the sign-in pages' security policy (`scripts/finish-headers.mjs`). Without it the sign-in page says sign-in is not available yet. For local work `.env.development` points it at `http://localhost:4242` and sets `PUBLIC_SAMPLE_REVIEWS=1`, which shows five placeholder reviews on the sign-in panel while there are no real ones. Never set that flag for a production build.

Account data (password hashes, phone numbers) is written to `server/accounts_db.json`, which is git-ignored. Back it up and keep it private.

Local testing without Google: start the API with `AUTH_DEV_GOOGLE=1` and the sign-in page shows a small "Local testing only" box that accepts any email as a pretend Google account. Never set this in production. `node scripts/test-auth.cjs` (repo root) runs the automated checks of the whole flow.

## Payments (Dodo Payments)

"Buy" buttons open `/buy/`. The buyer enters an email, the API (`server/dodo.cjs`) creates a Dodo checkout session and the browser goes to Dodo's hosted payment page. After payment Dodo sends the signed `payment.succeeded` webhook, the server creates the license key, and `/thanks/` shows it (it is also listed on the buyer's `/account/` page, matched by email). Card details never touch our server.

Set up once:

1. In the Dodo dashboard create a **one-time product** "FlowGet Pro" (price $19.99; Dodo can show local prices such as ₹999 with its regional pricing) and copy its id (`pdt_...`).
2. Create an **API key** (Developer > API Keys).
3. Add a **webhook endpoint** `https://api.flowget.net/api/webhook/dodo` subscribed to `payment.succeeded`, `refund.succeeded` and `dispute.lost`, and copy its signing secret (`whsec_...`).
4. Start the API with these settings (all required for payments):

| Setting | Meaning |
| --- | --- |
| `DODO_API_KEY` | the API key |
| `DODO_PRODUCT_ID` | the product id |
| `DODO_WEBHOOK_SECRET` | the webhook signing secret. Without it the webhook refuses everything. |
| `DODO_ENV` | `test` (default) or `live` |
| `SITE_URL` | public website address used for the return page, e.g. `https://flowget.net` |

5. Build the site with `PUBLIC_API_URL` set (see above). Test with Dodo's test mode (`DODO_ENV=test`, test API key) before going live.

What the webhook does: verifies the Standard Webhooks signature (rejects anything unsigned, forged or older than 5 minutes), ignores repeats, creates one license per payment, and revokes the license on a full refund (`refund.succeeded` without `is_partial`) or a lost dispute. A revoked key can no longer be activated on new PCs; PCs already activated keep working offline because the key is checked on the PC.

Tests: `node scripts/test-dodo.cjs` (checkout, signatures, replays, refunds, against a fake Dodo API).

## Admin panel

`/admin/` (not linked from the site, not in the sitemap) shows:

- **Overview**: revenue, purchases, refunds, users, checkout conversion, licenses and active PCs, plus 30-day charts of new users and purchases.
- **Users**: every account with name, email, phone, join date, how they sign in and how many licenses they own. Search and CSV export.
- **Purchases**: every payment with amount, license id, how many PCs activated it and its status. **Revoke** or **Restore** a license, CSV export, and a list of checkouts that were started but not paid.
- **Blog**: write a post (title, address, description, tags, date, cover image, Markdown article, FAQ, draft, featured) and publish it; lists the existing posts.

Who can enter: only accounts whose email is in the server setting `ADMIN_EMAILS` (comma separated). Everyone else gets "not an admin". Sign in at `/signin/` as usual (Google first), then open `/admin/`; the account page also shows an "Admin panel" button for admins.

How blog publishing works: the website is static, so a post is a Markdown file in the repository. With `GITHUB_TOKEN` (fine-grained, this repository only, *Contents: Read and write*) and `GITHUB_REPO` set on the server, **Publish** commits the file (and the cover image) to GitHub and Cloudflare Pages rebuilds the site; the post is live in a minute or two. Without them, and when the `website` folder sits next to `server`, the file is written there (handy on your own computer). A post that already exists is only replaced when you tick the box.

Settings live in `server/.env` (copy `server/.env.example`). Tests: `node scripts/test-admin.cjs`.

**Dashboard details:** the Overview has a 7 / 30 / 90 day switch, each number is compared with the previous period of the same length, and charts show a tooltip on hover. The revenue chart is drawn in the currency with the most purchases (amounts in different currencies are never added together; the all-time total lists every currency). When the API runs with `AUTH_DEV_GOOGLE=1` (local testing only) a **Load demo data** button fills the dashboard with fake users and purchases, and **Remove demo data** deletes exactly those.

### The blog editor

The article field is a full editor (TOAST UI Editor, bundled in `public/js/vendor`, only loaded on the admin page, no usage tracking):

- **Toolbar:** headings, bold, italic, strikethrough, quote, horizontal line, bullet / numbered / task lists, indent, tables, links, inline code and code blocks.
- **Two views:** the visual editor (default) and a Markdown view with live preview; switch at the bottom. The text is always saved as plain Markdown, like the existing posts.
- **Pictures in the article:** drag, paste or use the picture button. The image is uploaded to `public/img/blog/` (PNG, JPG or WebP up to 2.5 MB) and inserted by address.
- **Paragraphs:** the visual editor writes two paragraphs with one line break; the panel adds the blank line Markdown needs, so paragraphs never run together on the site.
- **One H1:** the page title is the only H1, so a `# Heading` in the article is saved as `## Heading`.
- **Counters and autosave:** words, characters and reading time; the draft is kept in your browser every second and offered back after a closed tab.
- **Edit and delete:** the post list has **Edit** (loads any post, including the existing hand-written ones; saving keeps the original date and adds `updatedDate`) and **Delete**.
- Also: cover image, tags, FAQ questions, author, publish date (a future date keeps it hidden until then), draft and featured switches.

## Customer reviews

The right-hand panel of the sign-in, sign-up and buy pages shows a carousel of **real reviews** ("What buyers say", with arrows, one review turning every few seconds, pausing on hover). It stays hidden until at least one review is approved, so the site never shows invented testimonials.

- **Who can write:** a signed-in person who bought FlowGet Pro (and has not been refunded). They write a rating of 1 to 5 stars, an optional "what do you do" line and their experience on **My account > Your review**. One review per person; editing it sends it for approval again.
- **Approval:** new reviews wait in **Admin > Reviews** (a yellow badge shows how many). Approve, reject, unpublish or delete.
- **What is public:** the text, stars, role and a short name (first name and the initial of the last name, e.g. "Jane D."), marked "Verified buyer". Email and full name are never published.
- **Local testing:** *Load demo data* in the admin Overview also adds sample reviews (marked "demo") so you can see the carousel; *Remove demo data* deletes them.
- API: `GET /api/reviews` (public list, cached for a minute), `GET /api/reviews/mine`, `POST /api/reviews` (see `server/reviews.cjs`). Tests: `node scripts/test-reviews.cjs`.
