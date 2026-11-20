// Mirrors the Rust types in src-tauri/engine/src/{model,events}.rs (camelCase over JSON).

export type DownloadState =
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
}

export interface AddRequest {
  url: string;
  connections?: number;
  checksum?: string;
  saveDir?: string;
  referer?: string;
  userAgent?: string;
  cookies?: string;
  username?: string;
  password?: string;
  speedLimit?: number;
  startPaused?: boolean;
  /** Other links to the same file; verified (same size and ETag) before use. */
  mirrors?: string[];
}

export interface Settings {
  globalSpeedLimit: number;
  defaultConnections: number;
  minConnections: number;
  maxConnections: number;
  downloadDir: string;
  online: boolean;
}
