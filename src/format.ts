const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return "?";
  let v = n;
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${UNITS[i]}`;
}

export function formatSpeed(bps: number): string {
  return `${formatBytes(bps)}/s`;
}

export function formatSpeedMbps(bps: number): string {
  const mbps = (bps * 8) / (1024 * 1024);
  return `${mbps.toFixed(2)} Mbps`;
}

export function formatEta(secs: number | null): string {
  if (secs == null) return "--";
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m ${secs % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function formatDate(timestampSecs: number | null): string {
  if (!timestampSecs) return "--";
  const date = new Date(timestampSecs * 1000);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/** Segment `end` is u64::MAX when the length is unknown; JS rounds that to ~1.8e19. */
export function isUnbounded(end: number): boolean {
  return end > Number.MAX_SAFE_INTEGER;
}

export type FileCategoryType = 'Music' | 'Archive' | 'Video' | 'Program' | 'Document' | 'App' | 'Image' | 'Other';

export function getFileTypeLabel(fileName: string): FileCategoryType {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'mp3':
    case 'wav':
    case 'flac':
    case 'aac':
    case 'm4a':
    case 'ogg':
      return 'Music';
    case 'zip':
    case 'rar':
    case '7z':
    case 'tar':
    case 'gz':
    case 'bz2':
    case 'xz':
      return 'Archive';
    case 'mp4':
    case 'mkv':
    case 'avi':
    case 'mov':
    case 'webm':
    case 'wmv':
      return 'Video';
    case 'exe':
    case 'msi':
    case 'bat':
    case 'cmd':
    case 'bin':
      return 'Program';
    case 'apk':
    case 'xapk':
    case 'apks':
      return 'App';
    case 'pdf':
    case 'doc':
    case 'docx':
    case 'xls':
    case 'xlsx':
    case 'ppt':
    case 'pptx':
    case 'txt':
    case 'csv':
      return 'Document';
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'webp':
    case 'svg':
    case 'bmp':
    case 'ico':
    case 'iso':
    case 'img':
      return 'Image';
    default:
      return 'Other';
  }
}

/** The sidebar groups, in display order. */
export const SIDEBAR_CATEGORIES = ["Music", "Compressed", "Videos", "Programs", "Documents", "APKs", "Images", "Torrents"] as const;

const EXT_GROUPS: Record<string, string[]> = {
  Music: ["mp3", "wav", "wma", "m4a", "aac", "flac", "ogg", "opus", "alac", "aiff"],
  Compressed: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso", "tgz", "z", "dmg", "cab"],
  Videos: ["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "mpeg", "mpg", "3gp", "m3u8", "mpd"],
  Programs: ["exe", "msi", "bat", "cmd", "sh", "bin", "appx", "msix", "com"],
  Documents: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "odt", "csv", "epub"],
  APKs: ["apk", "xapk", "apks", "aab"],
  Images: ["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg", "ico", "tiff", "psd"],
  Torrents: ["torrent"],
};
const EXT_TO_GROUP = new Map<string, string>();
for (const [group, exts] of Object.entries(EXT_GROUPS)) for (const e of exts) EXT_TO_GROUP.set(e, group);

/**
 * The sidebar group a download belongs to. The stored category is used when it is one of the groups; downloads without
 * one (added by the browser extension, older entries) are sorted by their file extension, so no list is ever empty
 * just because a category was never saved.
 */
export function sidebarCategory(d: { category?: string | null; fileName?: string; url?: string }): string {
  const stored = (d.category || "").toLowerCase();
  const hit = SIDEBAR_CATEGORIES.find((c) => c.toLowerCase() === stored || (stored === "audio" && c === "Music") || (stored === "video" && c === "Videos"));
  if (hit) return hit;
  const nameExt = (d.fileName || "").split(".").pop()?.toLowerCase() || "";
  if (EXT_TO_GROUP.has(nameExt)) return EXT_TO_GROUP.get(nameExt)!;
  try {
    const path = new URL(d.url || "").pathname;
    const urlExt = path.split(".").pop()?.toLowerCase() || "";
    if (EXT_TO_GROUP.has(urlExt)) return EXT_TO_GROUP.get(urlExt)!;
  } catch {
    /* not a URL */
  }
  return "";
}
