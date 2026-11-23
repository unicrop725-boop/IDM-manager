//! Data types shared between the engine, the database and the UI.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::checksum::Checksum;
use crate::error::UserError;
use crate::events::SegmentProgress;
use crate::http::HttpOptions;
use crate::segments::Segment;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DownloadState {
    /// In a queue waiting for an available slot or scheduled time.
    Queued,
    /// Contacting the server to learn size / range support.
    Probing,
    Downloading,
    Paused,
    /// Checking the finished file's checksum.
    Verifying,
    Completed,
    Failed,
    Cancelled,
    /// The internet is down. Progress is saved; the download resumes by itself when the
    /// connection returns.
    WaitingForNetwork,
    /// The link was refused (403/410) and could not be refreshed. A fresh link is needed;
    /// progress is kept.
    LinkExpired,
}

impl DownloadState {
    pub fn is_active(self) -> bool {
        matches!(self, DownloadState::Probing | DownloadState::Downloading | DownloadState::Verifying)
    }
}

/// What the UI sends to start a download.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AddRequest {
    pub url: String,
    /// Folder to save into; defaults to the user's Downloads folder.
    pub save_dir: Option<String>,
    /// Override the detected file name.
    pub file_name: Option<String>,
    /// Number of parallel connections (1-32); defaults to the user setting.
    pub connections: Option<u32>,
    #[serde(flatten)]
    pub http: HttpOptions,
    /// Expected checksum: `"sha256:<hex>"`, `"md5:<hex>"`, `"sha1:<hex>"` or bare hex.
    pub checksum: Option<String>,
    /// Per-download speed limit in bytes/second (0 or none = unlimited).
    pub speed_limit: Option<u64>,
    /// Add to the list without starting.
    pub start_paused: bool,
    /// Add to the queue without starting immediately.
    pub start_queued: bool,
    /// Target category (e.g. "Music", "Compressed", "Videos", etc.).
    pub category: Option<String>,
    /// Queue identifier (e.g. "main").
    pub queue_id: Option<String>,
    /// Order index inside the queue.
    pub queue_order: Option<i32>,
    /// Other places that hold the **same file**. Each is verified (same size and ETag, supports
    /// ranges) before use; verified mirrors serve different segments at the same time.
    pub mirrors: Vec<String>,
    /// Video pages (YouTube, ...): the chosen yt-dlp format id, if the user picked one.
    pub media_format: Option<String>,
    /// Video pages: the chosen format has no video track.
    pub media_audio_only: Option<bool>,
    /// Video pages: re-encode to `mp4`, `mp3` or `m4a`.
    pub convert_to: Option<String>,
    /// Video pages: download the best stream at or below this height (e.g. 1080).
    pub media_height: Option<u32>,
    /// Video pages: prefer streams at or below this frame rate (e.g. 60).
    pub media_fps: Option<u32>,
}

/// Outcome of checking one mirror.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorReport {
    pub url: String,
    /// `true` = verified and in use.
    pub ok: bool,
    /// Why a mirror was not used, in plain language.
    pub reason: Option<String>,
}

/// Everything that is persisted about a download (in SQLite, as JSON).
/// New fields must be `#[serde(default)]` so old databases keep loading.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRecord {
    pub id: String,
    pub url: String,
    #[serde(default)]
    pub final_url: Option<String>,
    pub save_dir: String,
    pub file_name: String,
    /// True when the user chose the name, so the server's name is not applied.
    #[serde(default)]
    pub file_name_locked: bool,
    /// Full path of the destination file; empty until the file has been created.
    #[serde(default)]
    pub file_path: String,
    #[serde(default)]
    pub total_size: Option<u64>,
    #[serde(default)]
    pub downloaded: u64,
    /// `None` until the server has been probed. `Some(false)` = "Resume not supported".
    #[serde(default)]
    pub resume_supported: Option<bool>,
    #[serde(default)]
    pub mime: Option<String>,
    #[serde(default)]
    pub etag: Option<String>,
    #[serde(default)]
    pub last_modified: Option<String>,
    #[serde(default)]
    pub segments: Vec<Segment>,
    pub connections: u32,
    #[serde(default)]
    pub speed_limit: u64,
    #[serde(default)]
    pub http: HttpOptions,
    #[serde(default)]
    pub checksum: Option<Checksum>,
    #[serde(default)]
    pub checksum_verified: Option<bool>,
    /// Mirrors the user supplied (verified again on every run).
    #[serde(default)]
    pub mirrors: Vec<String>,
    /// Result of the latest mirror verification.
    #[serde(default)]
    pub mirror_report: Vec<MirrorReport>,
    pub state: DownloadState,
    #[serde(default)]
    pub error: Option<UserError>,
    pub created_at: i64,
    #[serde(default)]
    pub completed_at: Option<i64>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub queue_id: Option<String>,
    #[serde(default)]
    pub queue_order: Option<i32>,
    /// The download was running when the app closed (or crashed), as opposed to paused by the user.
    /// "Resume paused downloads on restart" only picks these up.
    #[serde(default)]
    pub interrupted: bool,
}

impl DownloadRecord {
    pub fn path(&self) -> Option<PathBuf> {
        if self.file_path.is_empty() {
            None
        } else {
            Some(PathBuf::from(&self.file_path))
        }
    }

    /// True if there is saved progress we can pick up from.
    pub fn has_resumable_progress(&self) -> bool {
        self.resume_supported == Some(true) && !self.segments.is_empty() && self.total_size.is_some()
    }

    /// The `If-Range` validator: a strong ETag if present, else Last-Modified.
    pub fn validator(&self) -> Option<String> {
        match &self.etag {
            Some(e) if !e.starts_with("W/") => Some(e.clone()),
            _ => self.last_modified.clone(),
        }
    }

    /// Forget all progress and server-derived facts (used by cancel / restart).
    pub fn reset_progress(&mut self) {
        self.segments.clear();
        self.downloaded = 0;
        self.total_size = None;
        self.resume_supported = None;
        self.etag = None;
        self.last_modified = None;
        self.final_url = None;
        self.checksum_verified = None;
        self.completed_at = None;
        self.error = None;
        // A fresh start picks the destination again (and re-detects the server's file name).
        self.file_path.clear();
    }
}

/// Snapshot for the UI. Deliberately has no credentials.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadInfo {
    pub id: String,
    pub url: String,
    pub file_name: String,
    pub file_path: String,
    pub save_dir: String,
    pub total_size: Option<u64>,
    pub downloaded: u64,
    pub state: DownloadState,
    /// `None` = not yet known. `Some(false)` means the UI should show "Resume not supported".
    pub resume_supported: Option<bool>,
    pub mime: Option<String>,
    pub connections: u32,
    pub speed_limit: u64,
    pub checksum: Option<String>,
    pub checksum_verified: Option<bool>,
    pub error: Option<UserError>,
    pub created_at: i64,
    pub completed_at: Option<i64>,
    // --- live values (zero / empty when not running) ---
    pub speed_bps: u64,
    pub eta_secs: Option<u64>,
    pub segments: Vec<SegmentProgress>,
    /// Short status line such as "Connection lost, retrying...".
    pub note: Option<String>,
    /// Wire protocol of the latest response: "HTTP/3", "HTTP/2" or "HTTP/1.1".
    pub protocol: Option<String>,
    /// How each mirror the user supplied was judged.
    pub mirrors: Vec<MirrorReport>,
    pub category: Option<String>,
    pub queue_id: Option<String>,
    pub queue_order: Option<i32>,
}
