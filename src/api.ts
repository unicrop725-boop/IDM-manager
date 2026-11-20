// Typed wrappers around Tauri commands (src-tauri/src/commands.rs).

import { invoke } from "@tauri-apps/api/core";
import type {
  AddRequest,
  AdapterInfo,
  Category,
  DownloadInfo,
  DuplicateCheckResult,
  QueueInfo,
  Settings,
  TrialAndLicenseStatus,
} from "./types";

const isTauri = typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__);

const mockCategories: Category[] = [
  { id: "music", name: "Music", extensions: ["mp3", "wav", "flac", "aac", "m4a"], defaultFolder: "C:\\Downloads\\Music", isBuiltin: true },
  { id: "compressed", name: "Compressed", extensions: ["zip", "rar", "7z", "tar", "gz"], defaultFolder: "C:\\Downloads\\Compressed", isBuiltin: true },
  { id: "videos", name: "Videos", extensions: ["mp4", "mkv", "avi", "mov", "webm"], defaultFolder: "C:\\Downloads\\Videos", isBuiltin: true },
  { id: "programs", name: "Programs", extensions: ["exe", "msi", "bat", "cmd"], defaultFolder: "C:\\Downloads\\Programs", isBuiltin: true },
  { id: "documents", name: "Documents", extensions: ["pdf", "doc", "docx", "xls", "txt"], defaultFolder: "C:\\Downloads\\Documents", isBuiltin: true },
  { id: "apks", name: "APKs", extensions: ["apk", "xapk"], defaultFolder: "C:\\Downloads\\APKs", isBuiltin: true },
  { id: "images", name: "Images", extensions: ["jpg", "jpeg", "png", "gif", "iso"], defaultFolder: "C:\\Downloads\\Images", isBuiltin: true },
  { id: "torrents", name: "Torrents", extensions: ["torrent"], defaultFolder: "C:\\Downloads\\Torrents", isBuiltin: true },
  { id: "others", name: "Others", extensions: [], defaultFolder: "C:\\Downloads\\Others", isBuiltin: true },
];

const mockQueues: QueueInfo[] = [
  { id: "main", name: "Main Queue", maxConcurrent: 4, isRunning: true, schedule: null, createdAt: Date.now() / 1000 - 86400 },
  {
    id: "night",
    name: "Night Queue",
    maxConcurrent: 2,
    isRunning: false,
    schedule: {
      enabled: true,
      startTime: "02:00:00",
      stopTime: "06:00:00",
      daysOfWeek: [1, 2, 3, 4, 5],
      actionAfterCompletion: "sleep",
      wifiOnly: true,
      nightOnly: true,
    },
    createdAt: Date.now() / 1000 - 43200,
  },
];

const mockSettings: Settings = {
  globalSpeedLimit: 0,
  defaultConnections: 8,
  minConnections: 1,
  maxConnections: 32,
  downloadDir: "C:\\Downloads",
  online: true,
  turboMode: true,
  proxy: null,
  startWithWindows: true,
  fileTypes: "ZIP,RAR,7Z,EXE,MSI,ISO,MP4,MKV,MP3,PDF",
  language: "English",
  theme: "dark",
  autoExtract: true,
  virusScan: true,
  openFolderOnComplete: false,
  batterySaver: true,
  smartNaming: true,
  portableMode: false,
  mobileSharingEnabled: true,
  bandwidthMonitorEnabled: true,
};

let mockLicenseStatus: TrialAndLicenseStatus = {
  isLicensed: false,
  isTrial: true,
  isExpired: false,
  daysRemaining: 28,
  trialStartedAt: Math.floor(Date.now() / 1000) - 86400 * 2,
  maxConnections: 32,
  turboModeAllowed: true,
  mediaDownloadAllowed: true,
  licenseKey: null,
  licenseEmail: null,
  licenseTier: null,
};

const mockDownloads: DownloadInfo[] = [
  {
    id: "dl-1",
    url: "https://releases.ubuntu.com/24.04/ubuntu-24.04-desktop-amd64.iso",
    fileName: "ubuntu-24.04-desktop-amd64.iso",
    filePath: "C:\\Downloads\\Images\\ubuntu-24.04-desktop-amd64.iso",
    saveDir: "C:\\Downloads\\Images",
    totalSize: 5040000000,
    downloaded: 3528000000,
    state: "downloading",
    resumeSupported: true,
    mime: "application/x-iso9660-image",
    connections: 8,
    speedLimit: 0,
    checksum: null,
    checksumVerified: null,
    error: null,
    createdAt: Math.floor(Date.now() / 1000) - 300,
    completedAt: null,
    speedBps: 18450000,
    etaSecs: 82,
    segments: [
      { index: 0, start: 0, end: 630000000, downloaded: 630000000 },
      { index: 1, start: 630000001, end: 1260000000, downloaded: 630000000 },
      { index: 2, start: 1260000001, end: 1890000000, downloaded: 630000000 },
      { index: 3, start: 1890000001, end: 2520000000, downloaded: 630000000 },
      { index: 4, start: 2520000001, end: 3150000000, downloaded: 630000000 },
      { index: 5, start: 3150000001, end: 3780000000, downloaded: 378000000 },
      { index: 6, start: 3780000001, end: 4410000000, downloaded: 0 },
      { index: 7, start: 4410000001, end: 5040000000, downloaded: 0 },
    ],
    note: null,
    protocol: "HTTP/3",
    mirrors: [],
    category: "Images",
    queueId: "main",
  },
  {
    id: "dl-2",
    url: "https://cdn.example.com/patches/Cyberpunk_2077_Patch_v2.1.zip",
    fileName: "Cyberpunk_2077_Patch_v2.1.zip",
    filePath: "C:\\Downloads\\Compressed\\Cyberpunk_2077_Patch_v2.1.zip",
    saveDir: "C:\\Downloads\\Compressed",
    totalSize: 19400000000,
    downloaded: 9700000000,
    state: "downloading",
    resumeSupported: true,
    mime: "application/zip",
    connections: 16,
    speedLimit: 0,
    checksum: null,
    checksumVerified: null,
    error: null,
    createdAt: Math.floor(Date.now() / 1000) - 600,
    completedAt: null,
    speedBps: 24200000,
    etaSecs: 401,
    segments: Array.from({ length: 8 }, (_, i) => ({
      index: i,
      start: i * 2425000000,
      end: (i + 1) * 2425000000 - 1,
      downloaded: i < 4 ? 2425000000 : 0,
    })),
    note: null,
    protocol: "HTTP/2",
    mirrors: [],
    category: "Compressed",
    queueId: "main",
  },
  {
    id: "dl-3",
    url: "https://nodejs.org/dist/v22.11.0/node-v22.11.0-x64.msi",
    fileName: "node-v22.11.0-x64.msi",
    filePath: "C:\\Downloads\\Programs\\node-v22.11.0-x64.msi",
    saveDir: "C:\\Downloads\\Programs",
    totalSize: 34500000,
    downloaded: 31050000,
    state: "downloading",
    resumeSupported: true,
    mime: "application/x-msi",
    connections: 4,
    speedLimit: 0,
    checksum: null,
    checksumVerified: null,
    error: null,
    createdAt: Math.floor(Date.now() / 1000) - 45,
    completedAt: null,
    speedBps: 8400000,
    etaSecs: 1,
    segments: [],
    note: null,
    protocol: "HTTP/2",
    mirrors: [],
    category: "Programs",
    queueId: "main",
  },
  {
    id: "dl-4",
    url: "https://movies.example.com/Interstellar.2014.2160p.HDR.mkv",
    fileName: "Interstellar.2014.2160p.HDR.mkv",
    filePath: "C:\\Downloads\\Videos\\Interstellar.2014.2160p.HDR.mkv",
    saveDir: "C:\\Downloads\\Videos",
    totalSize: 25800000000,
    downloaded: 8256000000,
    state: "downloading",
    resumeSupported: true,
    mime: "video/x-matroska",
    connections: 12,
    speedLimit: 0,
    checksum: null,
    checksumVerified: null,
    error: null,
    createdAt: Math.floor(Date.now() / 1000) - 900,
    completedAt: null,
    speedBps: 16800000,
    etaSecs: 1044,
    segments: [],
    note: null,
    protocol: "HTTP/3",
    mirrors: [],
    category: "Videos",
    queueId: "main",
  },
  {
    id: "dl-5",
    url: "https://blackmagicdesign.com/DaVinci_Resolve_Studio_19.0.zip",
    fileName: "DaVinci_Resolve_Studio_19.0.zip",
    filePath: "C:\\Downloads\\Compressed\\DaVinci_Resolve_Studio_19.0.zip",
    saveDir: "C:\\Downloads\\Compressed",
    totalSize: 4500000000,
    downloaded: 2475000000,
    state: "downloading",
    resumeSupported: true,
    mime: "application/zip",
    connections: 8,
    speedLimit: 0,
    checksum: null,
    checksumVerified: null,
    error: null,
    createdAt: Math.floor(Date.now() / 1000) - 200,
    completedAt: null,
    speedBps: 12500000,
    etaSecs: 162,
    segments: [],
    note: null,
    protocol: "HTTP/2",
    mirrors: [],
    category: "Compressed",
    queueId: "main",
  },
  {
    id: "dl-6",
    url: "https://music.archive.org/audio/Spotify-Master-Collection-FLAC.zip",
    fileName: "Spotify-Master-Collection-FLAC.zip",
    filePath: "C:\\Downloads\\Music\\Spotify-Master-Collection-FLAC.zip",
    saveDir: "C:\\Downloads\\Music",
    totalSize: 1250000000,
    downloaded: 987500000,
    state: "downloading",
    resumeSupported: true,
    mime: "application/zip",
    connections: 6,
    speedLimit: 0,
    checksum: null,
    checksumVerified: null,
    error: null,
    createdAt: Math.floor(Date.now() / 1000) - 120,
    completedAt: null,
    speedBps: 9800000,
    etaSecs: 27,
    segments: [],
    note: null,
    protocol: "HTTP/2",
    mirrors: [],
    category: "Music",
    queueId: "main",
  },
  {
    id: "dl-7",
    url: "https://developer.android.com/platform-tools-latest-windows.zip",
    fileName: "platform-tools-latest-windows.zip",
    filePath: "C:\\Downloads\\Programs\\platform-tools-latest-windows.zip",
    saveDir: "C:\\Downloads\\Programs",
    totalSize: 188000000,
    downloaded: 178600000,
    state: "downloading",
    resumeSupported: true,
    mime: "application/zip",
    connections: 4,
    speedLimit: 0,
    checksum: null,
    checksumVerified: null,
    error: null,
    createdAt: Math.floor(Date.now() / 1000) - 60,
    completedAt: null,
    speedBps: 8200000,
    etaSecs: 1,
    segments: [],
    note: null,
    protocol: "HTTP/2",
    mirrors: [],
    category: "Programs",
    queueId: "main",
  },
  {
    id: "dl-8",
    url: "https://desktop.figma.com/win/Figma-Setup-v116.15.exe",
    fileName: "Figma-Setup-v116.15.exe",
    filePath: "C:\\Downloads\\Programs\\Figma-Setup-v116.15.exe",
    saveDir: "C:\\Downloads\\Programs",
    totalSize: 118000000,
    downloaded: 70800000,
    state: "downloading",
    resumeSupported: true,
    mime: "application/x-msdownload",
    connections: 4,
    speedLimit: 0,
    checksum: null,
    checksumVerified: null,
    error: null,
    createdAt: Math.floor(Date.now() / 1000) - 40,
    completedAt: null,
    speedBps: 5600000,
    etaSecs: 8,
    segments: [],
    note: null,
    protocol: "HTTP/2",
    mirrors: [],
    category: "Programs",
    queueId: "main",
  },
  {
    id: "dl-9",
    url: "https://www.deeplearningbook.org/contents/DeepLearning_IanGoodfellow.pdf",
    fileName: "DeepLearning_IanGoodfellow.pdf",
    filePath: "C:\\Downloads\\Documents\\DeepLearning_IanGoodfellow.pdf",
    saveDir: "C:\\Downloads\\Documents",
    totalSize: 48000000,
    downloaded: 39360000,
    state: "downloading",
    resumeSupported: true,
    mime: "application/pdf",
    connections: 4,
    speedLimit: 0,
    checksum: null,
    checksumVerified: null,
    error: null,
    createdAt: Math.floor(Date.now() / 1000) - 30,
    completedAt: null,
    speedBps: 4200000,
    etaSecs: 2,
    segments: [],
    note: null,
    protocol: "HTTP/2",
    mirrors: [],
    category: "Documents",
    queueId: "main",
  },
  {
    id: "dl-10",
    url: "https://download.blender.org/release/Blender4.2/blender-4.2.0-windows-x64.msi",
    fileName: "blender-4.2.0-windows-x64.msi",
    filePath: "C:\\Downloads\\Programs\\blender-4.2.0-windows-x64.msi",
    saveDir: "C:\\Downloads\\Programs",
    totalSize: 356000000,
    downloaded: 53400000,
    state: "downloading",
    resumeSupported: true,
    mime: "application/x-msi",
    connections: 8,
    speedLimit: 0,
    checksum: null,
    checksumVerified: null,
    error: null,
    createdAt: Math.floor(Date.now() / 1000) - 25,
    completedAt: null,
    speedBps: 11200000,
    etaSecs: 27,
    segments: [],
    note: null,
    protocol: "HTTP/3",
    mirrors: [],
    category: "Programs",
    queueId: "main",
  },
  {
    id: "dl-11",
    url: "https://code.visualstudio.com/sha/download?build=stable&os=win32-x64-user",
    fileName: "VSCodeUserSetup-x64-1.95.0.exe",
    filePath: "C:\\Downloads\\Programs\\VSCodeUserSetup-x64-1.95.0.exe",
    saveDir: "C:\\Downloads\\Programs",
    totalSize: 98500000,
    downloaded: 98500000,
    state: "completed",
    resumeSupported: true,
    mime: "application/x-msdownload",
    connections: 8,
    speedLimit: 0,
    checksum: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    checksumVerified: true,
    error: null,
    createdAt: Math.floor(Date.now() / 1000) - 7200,
    completedAt: Math.floor(Date.now() / 1000) - 7180,
    speedBps: 0,
    etaSecs: null,
    segments: [],
    note: null,
    protocol: "HTTP/2",
    mirrors: [],
    category: "Programs",
    queueId: "main",
  },
  {
    id: "dl-12",
    url: "https://static.rust-lang.org/dist/rust-1.82.0-x86_64-pc-windows-msvc.msi",
    fileName: "rust-1.82.0-x86_64-pc-windows-msvc.msi",
    filePath: "C:\\Downloads\\Programs\\rust-1.82.0-x86_64-pc-windows-msvc.msi",
    saveDir: "C:\\Downloads\\Programs",
    totalSize: 172000000,
    downloaded: 172000000,
    state: "completed",
    resumeSupported: true,
    mime: "application/x-msi",
    connections: 8,
    speedLimit: 0,
    checksum: null,
    checksumVerified: null,
    error: null,
    createdAt: Math.floor(Date.now() / 1000) - 14400,
    completedAt: Math.floor(Date.now() / 1000) - 14375,
    speedBps: 0,
    etaSecs: null,
    segments: [],
    note: null,
    protocol: "HTTP/2",
    mirrors: [],
    category: "Programs",
    queueId: "main",
  },
];

export const api = {
  // Downloads
  addDownload: (request: AddRequest) =>
    isTauri ? invoke<DownloadInfo>("add_download", { request }) : Promise.resolve({
      id: "dl-" + Date.now(),
      url: request.url,
      fileName: request.fileName || "file.bin",
      filePath: "C:\\Downloads\\" + (request.fileName || "file.bin"),
      saveDir: request.saveDir || "C:\\Downloads",
      totalSize: 104857600,
      downloaded: 0,
      state: request.startPaused ? "paused" : request.startQueued ? "queued" : "downloading",
      resumeSupported: true,
      mime: null,
      connections: request.connections || 8,
      speedLimit: request.speedLimit || 0,
      checksum: request.checksum || null,
      checksumVerified: null,
      error: null,
      createdAt: Math.floor(Date.now() / 1000),
      completedAt: null,
      speedBps: 1024 * 1024 * 5,
      etaSecs: 20,
      segments: [],
      note: null,
      protocol: "HTTP/2",
      mirrors: [],
      category: request.category || "Others",
      queueId: request.queueId || "main",
    }),
  pause: (id: string) => (isTauri ? invoke<void>("pause", { id }) : Promise.resolve()),
  resume: (id: string) => (isTauri ? invoke<void>("resume", { id }) : Promise.resolve()),
  markQueued: (id: string) => (isTauri ? invoke<void>("mark_queued", { id }) : Promise.resolve()),
  cancel: (id: string) => (isTauri ? invoke<void>("cancel", { id }) : Promise.resolve()),
  restart: (id: string) => (isTauri ? invoke<void>("restart", { id }) : Promise.resolve()),
  refreshLink: (id: string, newUrl: string) =>
    isTauri ? invoke<void>("refresh_link", { id, newUrl }) : Promise.resolve(),
  remove: (id: string, deleteFile: boolean) =>
    isTauri ? invoke<void>("remove", { id, deleteFile }) : Promise.resolve(),
  getDownloads: () =>
    isTauri ? invoke<DownloadInfo[]>("get_downloads") : Promise.resolve(mockDownloads),
  setDownloadMeta: (id: string, category?: string | null, queueId?: string | null, queueOrder?: number | null) =>
    isTauri
      ? invoke<DownloadInfo>("set_download_meta", { id, category, queueId, queueOrder })
      : Promise.resolve(mockDownloads[0]),
  setSpeedLimit: (id: string | null, bytesPerSec: number) =>
    isTauri ? invoke<void>("set_speed_limit", { id, bytesPerSec }) : Promise.resolve(),

  // Duplicate Detection
  checkDuplicate: (url: string, saveDir?: string, fileName?: string) =>
    isTauri
      ? invoke<DuplicateCheckResult>("check_duplicate", { url, saveDir, fileName })
      : Promise.resolve({
          hasDuplicate: false,
          fileExists: false,
          suggestedFileName: fileName || "file(1).bin",
        }),

  // Categories
  getCategories: () =>
    isTauri ? invoke<Category[]>("get_categories") : Promise.resolve(mockCategories),
  saveCategory: (category: Category) =>
    isTauri ? invoke<void>("save_category", { category }) : Promise.resolve(),
  deleteCategory: (id: string) =>
    isTauri ? invoke<void>("delete_category", { id }) : Promise.resolve(),
  autoCategorize: (nameOrUrl: string) =>
    isTauri ? invoke<string>("auto_categorize", { nameOrUrl }) : Promise.resolve("compressed"),

  // Queues
  getQueues: () =>
    isTauri ? invoke<QueueInfo[]>("get_queues") : Promise.resolve(mockQueues),
  saveQueue: (queue: QueueInfo) =>
    isTauri ? invoke<void>("save_queue", { queue }) : Promise.resolve(),
  deleteQueue: (id: string) =>
    isTauri ? invoke<void>("delete_queue", { id }) : Promise.resolve(),
  setQueueRunning: (id: string, running: boolean) =>
    isTauri ? invoke<void>("set_queue_running", { id, running }) : Promise.resolve(),
  reorderQueue: (queueId: string, downloadIds: string[]) =>
    isTauri ? invoke<void>("reorder_queue", { queueId, downloadIds }) : Promise.resolve(),
  moveToQueue: (id: string, queueId: string) =>
    isTauri ? invoke<void>("move_to_queue", { id, queueId }) : Promise.resolve(),

  // Post Download & System
  extractArchive: (path: string, targetDir?: string) =>
    isTauri
      ? invoke<string>("extract_archive", { path, targetDir })
      : Promise.resolve("Archive extracted successfully."),
  scanFileDefender: (path: string) =>
    isTauri
      ? invoke<string>("scan_file_defender", { path })
      : Promise.resolve("Windows Defender scan clean. No threats found."),
  openFolder: (path: string) =>
    isTauri ? invoke<void>("open_folder", { path }) : Promise.resolve(),
  openFile: (path: string) =>
    isTauri ? invoke<void>("open_file", { path }) : Promise.resolve(),
  getStartWithWindows: () =>
    isTauri ? invoke<boolean>("get_start_with_windows") : Promise.resolve(true),
  setStartWithWindows: (enabled: boolean) =>
    isTauri ? invoke<boolean>("set_start_with_windows", { enabled }) : Promise.resolve(enabled),

  // Settings
  getSettings: () =>
    isTauri ? invoke<Settings>("get_settings") : Promise.resolve(mockSettings),
  setSetting: (key: string, value: string) =>
    isTauri ? invoke<void>("set_setting", { key, value }) : Promise.resolve(),
  getSetting: (key: string) =>
    isTauri ? invoke<string | null>("get_setting", { key }) : Promise.resolve(null),
  setDefaultConnections: (connections: number) =>
    isTauri ? invoke<number>("set_default_connections", { connections }) : Promise.resolve(connections),
  getAdapters: () =>
    isTauri ? invoke<AdapterInfo[]>("get_adapters") : Promise.resolve([]),
  setTurboMode: (enabled: boolean) =>
    isTauri ? invoke<boolean>("set_turbo_mode", { enabled }) : Promise.resolve(enabled),

  // Phase 6: Protocols, Streaming Media, Batch & Site Grabber
  expandBatch: (input: string) =>
    isTauri
      ? invoke<{ urls: string[]; total: number }>("expand_batch_patterns", { input })
      : Promise.resolve({ urls: input.split("\n").map((s) => s.trim()).filter(Boolean), total: 1 }),
  crawlSite: (req: import("./types").GrabSiteRequest) =>
    isTauri
      ? invoke<import("./types").GrabbedAsset[]>("crawl_website", { req })
      : Promise.resolve([]),
  resolveVideo: (url: string): Promise<import("./types").MediaResolveResult> =>
    isTauri
      ? invoke<import("./types").MediaResolveResult>("resolve_video_media", { url })
      : Promise.resolve({
          isSupported: true,
          isDrm: false,
          drmMessage: undefined,
          title: "Sample Video Stream",
          thumbnail: undefined,
          duration: 120,
          formats: [
            { formatId: "1080", qualityLabel: "1080p Full HD", ext: "mp4", isAudioOnly: false },
            { formatId: "720", qualityLabel: "720p HD", ext: "mp4", isAudioOnly: false },
            { formatId: "audio", qualityLabel: "Audio Only", ext: "mp3", isAudioOnly: true },
          ],
        }),
  downloadStreamMedia: (req: {
    url: string;
    saveDir: string;
    fileName: string;
    formatId?: string;
    convertTo?: string;
  }) =>
    isTauri
      ? invoke<string>("download_stream_media", req)
      : Promise.resolve(""),
  updateYtdlp: () =>
    isTauri ? invoke<string>("update_ytdlp") : Promise.resolve("yt-dlp is up to date."),

  // Phase 8: Licensing & 30-Day Trial
  getLicenseStatus: (): Promise<TrialAndLicenseStatus> =>
    isTauri ? invoke<TrialAndLicenseStatus>("get_license_status") : Promise.resolve(mockLicenseStatus),
  activateLicense: (key: string): Promise<TrialAndLicenseStatus> => {
    if (!isTauri) {
      if (key.startsWith("FG1.")) {
        mockLicenseStatus = {
          ...mockLicenseStatus,
          isLicensed: true,
          isTrial: false,
          isExpired: false,
          licenseKey: key,
          licenseEmail: "customer@example.com",
          licenseTier: "lifetime",
          maxConnections: 32,
          turboModeAllowed: true,
          mediaDownloadAllowed: true,
        };
      }
      return Promise.resolve(mockLicenseStatus);
    }
    return invoke<TrialAndLicenseStatus>("activate_license_key", { key });
  },
  deactivateLicense: (): Promise<TrialAndLicenseStatus> => {
    if (!isTauri) {
      mockLicenseStatus = {
        ...mockLicenseStatus,
        isLicensed: false,
        isTrial: false,
        isExpired: true,
        daysRemaining: 0,
        licenseKey: null,
        licenseEmail: null,
        licenseTier: null,
        maxConnections: 2,
        turboModeAllowed: false,
        mediaDownloadAllowed: false,
      };
      return Promise.resolve(mockLicenseStatus);
    }
    return invoke<TrialAndLicenseStatus>("deactivate_license_key");
  },
};

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}
