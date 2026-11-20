//! Smart file naming: cleans messy URLs and file names automatically.

export function cleanFileName(raw: string): string {
  if (!raw) return "";

  // 1. Strip URL query params & fragments
  let clean = raw.split("?")[0].split("#")[0];

  // 2. Decode URL encoding (%20, etc.)
  try {
    clean = decodeURIComponent(clean);
  } catch {
    clean = clean.replace(/%20/g, " ");
  }

  // 3. Extract base filename if a path or URL was passed
  const parts = clean.split(/[/\\]/);
  let name = parts[parts.length - 1] || clean;

  // Split name and extension
  const lastDot = name.lastIndexOf(".");
  if (lastDot === -1 || lastDot === 0) {
    return cleanBaseName(name);
  }

  const base = name.slice(0, lastDot);
  const ext = name.slice(lastDot);

  const cleanedBase = cleanBaseName(base);
  return `${cleanedBase}${ext}`;
}

function cleanBaseName(base: string): string {
  let cleaned = base;

  // Remove trailing random hex IDs (e.g. _a1b2c3d4 or -39f82d1c)
  cleaned = cleaned.replace(/[-_][0-9a-fA-F]{8,32}$/, "");

  // Remove trailing random timestamp/digit IDs (e.g. _1712938472983)
  cleaned = cleaned.replace(/[-_]\d{10,16}$/, "");

  // Remove tracking tokens like [1080p] or redundant tags
  cleaned = cleaned.replace(/[-_]v\d+([._]\d+)*$/, "");

  // Replace multiple underscores, hyphens, or pluses with a clean single space or hyphen
  cleaned = cleaned.replace(/[+_]/g, " ");
  cleaned = cleaned.replace(/\s+/g, " ");
  cleaned = cleaned.trim();

  return cleaned || base;
}
