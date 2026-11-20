//! Events the engine emits. The app layer forwards them to the UI and persists them.

use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;

use crate::model::{DownloadInfo, DownloadRecord};
use crate::segments::Segment;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SegmentProgress {
    pub index: u32,
    pub start: u64,
    /// Inclusive end; `u64::MAX` for streams of unknown length.
    pub end: u64,
    pub downloaded: u64,
}

impl From<&Segment> for SegmentProgress {
    fn from(s: &Segment) -> Self {
        Self { index: s.index, start: s.start, end: s.end, downloaded: s.downloaded }
    }
}

/// What the engine learned about the best number of connections for a website.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DomainBest {
    pub domain: String,
    pub connections: u32,
    /// Average speed (bytes/s) the download achieved with that many connections.
    pub speed_bps: u64,
}

/// Live numbers for one network adapter (Turbo Mode).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AdapterProgress {
    pub id: String,
    pub name: String,
    pub kind: crate::adapters::AdapterKind,
    pub ip: String,
    /// Smoothed speed through this adapter, bytes per second.
    pub speed_bps: u64,
    /// Bytes received through this adapter in this run.
    pub bytes: u64,
    /// Connections currently bound to it.
    pub connections: u32,
}

/// Sent about every 250 ms per running download.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub id: String,
    pub downloaded: u64,
    pub total: Option<u64>,
    /// Smoothed (moving-average) speed in bytes per second.
    pub speed_bps: u64,
    pub eta_secs: Option<u64>,
    pub segments: Vec<SegmentProgress>,
    pub note: Option<String>,
    /// "HTTP/3", "HTTP/2" or "HTTP/1.1" (latest response).
    pub protocol: Option<String>,
    /// Connections the engine is currently trying to keep busy (grows with AIMD, halves on refusals).
    #[serde(default)]
    pub connections: u32,
    /// Speed per network adapter; empty unless Turbo Mode is bonding two or more networks.
    #[serde(default)]
    pub adapters: Vec<AdapterProgress>,
}

pub enum EngineEvent {
    /// Live progress (UI only).
    Progress(ProgressEvent),
    /// State or metadata changed: the UI should replace its copy of this download.
    Updated(DownloadInfo),
    /// Durable state to write to the database. Progress in it is already fsync'ed to disk.
    Persist(Box<DownloadRecord>),
    /// The download was removed: delete it from the database and the UI.
    Removed(String),
    /// The best connection count learned for a domain changed: store it (and reuse it next time).
    DomainBest(DomainBest),
    /// Barrier: replied to once every earlier event has been handled (used on shutdown).
    Flush(oneshot::Sender<()>),
}
