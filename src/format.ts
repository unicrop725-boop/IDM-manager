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
