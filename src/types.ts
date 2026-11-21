// Mirrors the Rust types in src-tauri/engine/src/{model,events}.rs and src-tauri/src/db.rs (camelCase over JSON).

export type DownloadState =
  | "queued"
  | "probing"
  | "downloading"
  | "paused"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled"
  /** The internet is down; resumes by itself when it returns. */
  | "waitingForNetwork"
  /** The link was refused (403/410) and could not be refreshed: a fresh link is needed. */
  | "linkExpired";

export interface SegmentProgress {
  index: number;
  start: number;
  /** Inclusive end. A huge value (u64::MAX) means "length unknown". */
  end: number;
  downloaded: number;
}

export interface UserError {
  code: string;
  message: string;
}

/** How a mirror the user supplied was judged (same size + ETag = used). */
export interface MirrorReport {
  url: string;
  ok: boolean;
  reason: string | null;
}

/** A network adapter Turbo Mode can use (mirrors engine adapters.rs). */
export interface AdapterInfo {
  id: string;
  name: string;
  kind: "wifi" | "ethernet" | "mobile" | "other";
  ip: string;
}

/** Live speed through one adapter while Turbo Mode bonds two or more networks. */
export interface AdapterProgress extends AdapterInfo {
  speedBps: number;
  bytes: number;
  connections: number;
}

export interface DownloadInfo {
  id: string;
  url: string;
  fileName: string;
  filePath: string;
  saveDir: string;
  totalSize: number | null;
  downloaded: number;
  state: DownloadState;
  /** null = not probed yet; false = "Resume not supported". */
  resumeSupported: boolean | null;
  mime: string | null;
  connections: number;
  speedLimit: number;
  checksum: string | null;
  checksumVerified: boolean | null;
  error: UserError | null;
  createdAt: number;
  completedAt: number | null;
  speedBps: number;
  etaSecs: number | null;
  segments: SegmentProgress[];
  note: string | null;
  /** "HTTP/3", "HTTP/2" or "HTTP/1.1" (latest response). */
  protocol: string | null;
  mirrors: MirrorReport[];
  category?: string | null;
  queueId?: string | null;
  queueOrder?: number | null;
  referer?: string | null;
  description?: string | null;
  /** Live only (from progress events): speed per network adapter in Turbo Mode. */
  adapters?: AdapterProgress[];
  /** Live only: connections the engine is currently trying to keep busy (AIMD). */
  liveConnections?: number;
}

export interface ProgressEvent {
  id: string;
  downloaded: number;
  total: number | null;
  speedBps: number;
  etaSecs: number | null;
  segments: SegmentProgress[];
  note: string | null;
  protocol: string | null;
  connections: number;
  adapters: AdapterProgress[];
}

export interface AddRequest {
  url: string;
  connections?: number;
  checksum?: string;
  saveDir?: string;
  fileName?: string;
  category?: string;
  queueId?: string;
  queueOrder?: number;
  startPaused?: boolean;
  startQueued?: boolean;
  proxy?: string;
  referer?: string;
  userAgent?: string;
  cookies?: string;
  username?: string;
  password?: string;
  speedLimit?: number;
  /** Other links to the same file; verified (same size and ETag) before use. */
  mirrors?: string[];
  /** Video pages (YouTube, ...): chosen quality, whether it is audio only, and optional re-encode. */
  mediaFormat?: string;
  mediaAudioOnly?: boolean;
  convertTo?: "mp4" | "mkv" | "mp3" | "m4a";
  /** Video pages: best stream at or below this height / frame rate. */
  mediaHeight?: number;
  mediaFps?: number;
}

export interface Category {
  id: string;
  name: string;
  extensions: string[];
  defaultFolder: string;
  isBuiltin: boolean;
}

export interface QueueSchedule {
  enabled: boolean;
  startTime?: string | null;
  stopTime?: string | null;
  daysOfWeek: number[];
  actionAfterCompletion: "none" | "shutdown" | "sleep" | "hibernate" | "exitApp" | "runProgram" | string;
  runProgramPath?: string | null;
  wifiOnly: boolean;
  nightOnly: boolean;
  nightStartHour?: number | null;
  nightEndHour?: number | null;
}

export interface QueueInfo {
  id: string;
  name: string;
  maxConcurrent: number;
  isRunning: boolean;
  schedule?: QueueSchedule | null;
  createdAt: number;
}

export interface DuplicateCheckResult {
  hasDuplicate: boolean;
  urlMatch?: DownloadInfo | null;
  fileExists: boolean;
  existingFilePath?: string | null;
  suggestedFileName: string;
}

export interface Settings {
  globalSpeedLimit: number;
  defaultConnections: number;
  minConnections: number;
  maxConnections: number;
  downloadDir: string;
  online: boolean;
  turboMode: boolean;
  proxy?: string | null;
  startWithWindows: boolean;
  fileTypes: string;
  language: string;
  theme: string;
  autoExtract: boolean;
  virusScan: boolean;
  openFolderOnComplete: boolean;
  batterySaver?: boolean;
  smartNaming?: boolean;
  portableMode?: boolean;
  mobileSharingEnabled?: boolean;
  bandwidthMonitorEnabled?: boolean;
  clipboardMonitor?: boolean;
}

export interface MediaFormatOption {
  formatId: string;
  qualityLabel: string;
  resolution?: string;
  ext: string;
  fileSizeApprox?: number;
  isAudioOnly: boolean;
}

export interface VideoOption {
  height: number;
  fps: number;
  ext: string;
  fileSizeApprox?: number;
}

export interface MediaResolveResult {
  isSupported: boolean;
  isDrm: boolean;
  drmMessage?: string;
  title?: string;
  thumbnail?: string;
  duration?: number;
  formats: MediaFormatOption[];
  /** Real resolution + frame-rate combinations the site offers (highest first). */
  videoOptions?: VideoOption[];
  manifestType?: string;
}

export interface BatchExpandResult {
  urls: string[];
  total: number;
}

export interface GrabbedAsset {
  url: string;
  fileName: string;
  category: string;
  size?: number | null;
  selected: boolean;
}

export interface GrabSiteRequest {
  url: string;
  depth: number;
  categories: string[];
  customExtensions?: string[];
}

export interface TrialAndLicenseStatus {
  isLicensed: boolean;
  isTrial: boolean;
  isExpired: boolean;
  daysRemaining: number;
  trialStartedAt: number;
  maxConnections: number;
  turboModeAllowed: boolean;
  mediaDownloadAllowed: boolean;
  licenseKey?: string | null;
  licenseEmail?: string | null;
  licenseTier?: string | null;
}
