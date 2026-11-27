/**
 * The websites shown in the "Trusted Sites" area of BoltGrab.
 *
 * This is the one file to edit to change that list. Add one object per website:
 *
 *   {
 *     name: "Example Software",                  // shown as the card title
 *     url: "https://download.example.com/",     // opened in the user's browser
 *     category: "Software",                      // used for the filter buttons (any word you like)
 *     description: "Official downloads of …",    // one short sentence
 *     tags: ["official", "open source"],         // optional, searchable
 *     icon: "https://download.example.com/logo.png", // optional; the site's favicon is used when left out
 *   },
 *
 * Categories are created automatically from the list, so a new category word shows up as a new filter button.
 * Files downloaded from a website on this list get a green "Trusted site" mark in the Add Download window.
 */
export interface TrustedSite {
  name: string;
  url: string;
  category: string;
  description: string;
  tags?: string[];
  /** Optional picture for the site (a web address or a file in /public). Without it, the site's own favicon is used. */
  icon?: string;
}

export const TRUSTED_SITES: TrustedSite[] = [
  // DUMMY ENTRIES for testing the page: replace them with your real list.
  { name: "Example Software", url: "https://software.example.com/", category: "Software", description: "Official installers for popular programs, checked by the BoltGrab team.", tags: ["official"] },
  { name: "Open Tools Hub", url: "https://tools.example.org/", category: "Software", description: "Free and open-source tools with published checksums.", tags: ["open source", "free"] },
  { name: "Driver Depot", url: "https://drivers.example.com/", category: "Software", description: "Original drivers and firmware straight from the hardware makers.", tags: ["official"] },
  { name: "Portable Apps Corner", url: "https://portable.example.net/", category: "Software", description: "Apps that run from a USB drive without installing.", tags: ["portable", "free"] },
  { name: "Free Music Archive", url: "https://music.example.net/", category: "Music", description: "Royalty-free music you can download without an account.", tags: ["free"] },
  { name: "Podcast Vault", url: "https://podcasts.example.org/", category: "Music", description: "Podcasts and audio shows in MP3, no sign-up needed." },
  { name: "Public Domain Films", url: "https://films.example.com/", category: "Video", description: "Classic films that are out of copyright, in several qualities.", tags: ["free"] },
  { name: "Open Lectures", url: "https://lectures.example.edu/", category: "Video", description: "University lectures and courses you can watch and keep offline.", tags: ["education"] },
  { name: "Open Book Library", url: "https://books.example.org/", category: "Documents", description: "Thousands of freely licensed books and papers in PDF and EPUB.", tags: ["free", "education"] },
  { name: "Manuals Online", url: "https://manuals.example.com/", category: "Documents", description: "User manuals and datasheets for appliances and electronics." },
  { name: "Wallpaper Commons", url: "https://pics.example.com/", category: "Images", description: "Free high-resolution wallpapers and photos.", tags: ["free"] },
  { name: "Icon Studio", url: "https://icons.example.org/", category: "Images", description: "Icon packs and vector graphics with clear licences.", tags: ["open source"] },
  { name: "Linux Distro Mirror", url: "https://mirror.example.org/", category: "Operating Systems", description: "ISO images of Linux distributions with SHA-256 checksums.", tags: ["official", "open source"] },
  { name: "Retro Game Archive", url: "https://retro.example.net/", category: "Games", description: "Free and abandonware classics, with notes on each licence." },
];

/** Host name without "www.", lower case. Empty when the address cannot be read. */
export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** Where to load the site's picture from: the given icon, or the favicon the site itself serves. */
export const iconUrlOf = (site: TrustedSite): string => {
  if (site.icon) return site.icon;
  try {
    return new URL("/favicon.ico", site.url).toString();
  } catch {
    return "";
  }
};

/** The trusted site a download address belongs to (the site itself or one of its sub-domains), if any. */
export const findTrustedSite = (url: string, sites: TrustedSite[] = TRUSTED_SITES): TrustedSite | undefined => {
  const host = hostOf(url);
  if (!host) return undefined;
  return sites.find((s) => {
    const h = hostOf(s.url);
    return h !== "" && (host === h || host.endsWith("." + h));
  });
};
