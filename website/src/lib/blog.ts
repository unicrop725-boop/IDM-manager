import { getCollection, type CollectionEntry } from "astro:content";

export type Post = CollectionEntry<"blog">;

/** Published posts, newest first. Drafts and posts dated in the future stay hidden. */
export async function getPosts(): Promise<Post[]> {
  const now = Date.now();
  const all = await getCollection("blog", ({ data }) => !data.draft && data.pubDate.getTime() <= now);
  return all.sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());
}

/** About 220 words a minute. */
export function readingMinutes(body: string | undefined): number {
  const words = (body ?? "").replace(/```[\s\S]*?```/g, " ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

export const tagSlug = (tag: string): string =>
  tag.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** A tag only gets its own page when at least two articles share it (a page with one article is thin content). */
export const MIN_POSTS_FOR_TAG_PAGE = 2;

/** Slugs of the tags that have a page. */
export async function linkableTagSlugs(): Promise<Set<string>> {
  const tags = allTags(await getPosts());
  return new Set(tags.filter((t) => t.count >= MIN_POSTS_FOR_TAG_PAGE).map((t) => t.slug));
}

export function allTags(posts: Post[]): { tag: string; slug: string; count: number }[] {
  const map = new Map<string, { tag: string; slug: string; count: number }>();
  for (const p of posts) {
    for (const tag of p.data.tags) {
      const slug = tagSlug(tag);
      const cur = map.get(slug) ?? { tag, slug, count: 0 };
      cur.count++;
      map.set(slug, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Posts that share the most tags with `post` (newer first on a tie). */
export function relatedPosts(post: Post, posts: Post[], limit = 3): Post[] {
  const mine = new Set(post.data.tags.map(tagSlug));
  return posts
    .filter((p) => p.id !== post.id)
    .map((p) => ({ p, score: p.data.tags.filter((t) => mine.has(tagSlug(t))).length }))
    .sort((a, b) => b.score - a.score || b.p.data.pubDate.getTime() - a.p.data.pubDate.getTime())
    .slice(0, limit)
    .map((x) => x.p);
}

export const formatDate = (d: Date): string =>
  d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
