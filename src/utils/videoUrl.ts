/** Sites whose links are video *pages* (resolved with yt-dlp), mirrored from the backend list. */
const VIDEO_HOSTS = [
  "youtube.com",
  "youtu.be",
  "vimeo.com",
  "dailymotion.com",
  "twitch.tv",
  "tiktok.com",
  "instagram.com",
  "facebook.com",
  "fb.watch",
  "twitter.com",
  "x.com",
  "reddit.com",
  "pinterest.com",
  "pin.it",
];

export type VideoSite = "youtube" | "video";

/** Returns which kind of video site a pasted link belongs to, or null for ordinary links. */
export function getVideoSite(raw: string): VideoSite | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
  if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be") return "youtube";
  return VIDEO_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) ? "video" : null;
}

export function formatDuration(secs?: number | null): string {
  if (!secs || secs <= 0) return "";
  const s = Math.round(secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

export function heightLabel(h: number): string {
  if (h >= 4320) return `${h}p 8K`;
  if (h >= 2160) return `${h}p 4K`;
  if (h >= 1440) return `${h}p 2K`;
  if (h >= 1080) return `${h}p FHD`;
  if (h >= 720) return `${h}p HD`;
  return `${h}p`;
}
