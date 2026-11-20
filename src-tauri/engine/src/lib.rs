//! FlowGet download engine.
//!
//! This crate contains **no UI and no Tauri code**. The desktop app talks to it through
//! [`Engine`] (commands) and an event channel of [`EngineEvent`] (progress / state / persistence).
//!
//! Module map:
//! - [`probe`]    HEAD / ranged-GET detection of size, range support, name, validators
//! - [`segments`] splitting a file into byte ranges and resume bookkeeping
//! - [`writer`]   pre-allocated file written directly at byte offsets (no .part files, no merge)
//! - [`worker`]   per-segment HTTP download loop with retry / backoff
//! - [`limiter`]  token-bucket speed limiter (global + per download)
//! - [`http`]     client construction: redirects, cookies, headers, referer, user-agent, auth
//! - [`auth`]     Basic and Digest authentication
//! - [`manager`]  the [`Engine`]: lifecycle of all downloads, pause / resume / cancel / restart
//! - [`model`]    serialisable records and UI-facing snapshots
//! - [`events`]   events emitted towards the app layer

pub mod auth;
pub mod checksum;
pub mod error;
pub mod events;
pub mod filename;
pub mod http;
pub mod limiter;
pub mod manager;
pub mod model;
pub mod netwatch;
pub mod policy;
pub mod probe;
pub mod progress;
pub mod segments;
pub mod table;
pub mod worker;
pub mod writer;

pub use checksum::{Checksum, HashAlgo};
pub use error::{EngineError, RetryClass, UserError};
pub use events::{DomainBest, EngineEvent, ProgressEvent, SegmentProgress};
pub use http::{H3Plan, HttpOptions};
pub use manager::{DomainHint, Engine, EngineConfig, MAX_CONNECTIONS, MIN_CONNECTIONS};
pub use netwatch::{Connectivity, SystemConnectivity};
pub use model::{AddRequest, DownloadInfo, DownloadRecord, DownloadState, MirrorReport};
pub use segments::Segment;
