//! Error type for the engine, with messages written for normal users (project rule 6).

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// A user-presentable error that is stored in the download record and shown in the UI.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UserError {
    /// Stable machine-readable code (the UI can use it to pick an icon or a help link).
    pub code: String,
    /// Plain-language message.
    pub message: String,
}

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("invalid url: {0}")]
    InvalidUrl(String),
    #[error("unsupported scheme: {0}")]
    UnsupportedScheme(String),
    #[error("blocked: {0}")]
    Blocked(String),
    #[error("invalid option: {0}")]
    InvalidOption(String),
    #[error("network error: {0}")]
    Network(String),
    #[error("too many redirects")]
    TooManyRedirects,
    #[error("HTTP status {0}")]
    Http(u16),
    #[error("authentication failed")]
    AuthFailed,
    #[error("file changed on the server")]
    FileChanged,
    /// The server refused the link with 403/410: typically a signed URL that has expired.
    #[error("the download link has expired")]
    LinkExpired,
    #[error("server does not support resuming")]
    RangeIgnored,
    #[error("disk error: {0}")]
    Disk(String),
    #[error("disk full")]
    DiskFull,
    #[error("size mismatch: expected {expected}, got {actual}")]
    SizeMismatch { expected: u64, actual: u64 },
    #[error("checksum mismatch ({algo}): expected {expected}, got {actual}")]
    ChecksumMismatch {
        algo: String,
        expected: String,
        actual: String,
    },
    #[error("no such download: {0}")]
    NotFound(String),
    #[error("{0}")]
    InvalidState(String),
    /// Internal sentinel: the user paused / cancelled while an operation was in flight.
    /// It never reaches the UI.
    #[error("stopped")]
    Stopped,
    #[error("{0}")]
    Other(String),
}

/// How a failure should be retried (Phase 2 smart retry).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetryClass {
    /// Connection reset, timeout, DNS, TLS, early close: retry forever with backoff.
    Network,
    /// 408 / 425 / 429 / 5xx: the server is struggling; retry a limited number of times.
    Server,
    /// Other 4xx: probably permanent; retry only a couple of times.
    Client,
    /// Not retryable here (expired link, changed file, bad credentials, disk errors, ...).
    Fatal,
}

impl EngineError {
    pub fn retry_class(&self) -> RetryClass {
        match self {
            EngineError::Network(_) => RetryClass::Network,
            EngineError::Http(s) if matches!(*s, 408 | 425 | 429) || *s >= 500 => RetryClass::Server,
            EngineError::Http(s) if (400..500).contains(s) && !matches!(*s, 401 | 403 | 407 | 410 | 416) => {
                RetryClass::Client
            }
            _ => RetryClass::Fatal,
        }
    }

    /// Whether retrying (with backoff) can plausibly succeed.
    pub fn is_retryable(&self) -> bool {
        !matches!(self.retry_class(), RetryClass::Fatal)
    }

    pub fn code(&self) -> &'static str {
        match self {
            EngineError::InvalidUrl(_) => "invalid_url",
            EngineError::UnsupportedScheme(_) => "unsupported_scheme",
            EngineError::Blocked(_) => "blocked",
            EngineError::InvalidOption(_) => "invalid_option",
            EngineError::Network(_) => "network",
            EngineError::TooManyRedirects => "too_many_redirects",
            EngineError::Http(_) => "http",
            EngineError::AuthFailed => "auth_failed",
            EngineError::FileChanged => "file_changed",
            EngineError::LinkExpired => "link_expired",
            EngineError::RangeIgnored => "resume_unsupported",
            EngineError::Disk(_) => "disk",
            EngineError::DiskFull => "disk_full",
            EngineError::SizeMismatch { .. } => "size_mismatch",
            EngineError::ChecksumMismatch { .. } => "checksum_mismatch",
            EngineError::NotFound(_) => "not_found",
            EngineError::InvalidState(_) => "invalid_state",
            EngineError::Stopped => "stopped",
            EngineError::Other(_) => "other",
        }
    }

    /// Message for a normal user: what happened and, where possible, what to do.
    pub fn user_message(&self) -> String {
        match self {
            EngineError::InvalidUrl(_) => {
                "This link doesn't look valid. Check that it starts with http:// or https://.".into()
            }
            EngineError::UnsupportedScheme(s) => {
                format!("Links starting with \"{s}://\" are not supported yet. Use an http:// or https:// link.")
            }
            EngineError::Blocked(m) => m.clone(),
            EngineError::InvalidOption(m) => m.clone(),
            EngineError::Network(_) => {
                "The connection to the server was lost or timed out. Check your internet connection, then press Resume.".into()
            }
            EngineError::TooManyRedirects => {
                "The link keeps redirecting to other addresses and never reaches a file.".into()
            }
            EngineError::Http(404) | EngineError::Http(410) => {
                "The file was not found on the server. It may have been moved or deleted.".into()
            }
            EngineError::Http(401) | EngineError::Http(407) => {
                "The server asked for a username and password.".into()
            }
            EngineError::Http(403) => {
                "The server refused access (403). The link may have expired, or the site may need you to be signed in.".into()
            }
            EngineError::Http(429) => "The server says there were too many requests. Wait a moment and press Resume.".into(),
            EngineError::Http(s) if *s >= 500 => {
                format!("The server had a problem (error {s}). Try again later.")
            }
            EngineError::Http(s) => format!("The server refused the request (error {s})."),
            EngineError::AuthFailed => {
                "The username or password was not accepted by the server.".into()
            }
            EngineError::FileChanged => {
                "The file on the server has changed since this download started. Use Restart to download the new version.".into()
            }
            EngineError::LinkExpired => {
                "The download link has expired. Paste a fresh link for this file, or open the download page again.".into()
            }
            EngineError::RangeIgnored => {
                "The server no longer supports resuming this download. Use Restart to download it again from the beginning.".into()
            }
            EngineError::Disk(m) => format!("Could not write to the disk: {m}"),
            EngineError::DiskFull => {
                "There is not enough free space on the disk. Free some space, then press Resume.".into()
            }
            EngineError::SizeMismatch { expected, actual } => format!(
                "The downloaded file is the wrong size ({actual} bytes instead of {expected}). Use Restart to download it again."
            ),
            EngineError::ChecksumMismatch { algo, .. } => format!(
                "The file finished downloading but its {algo} checksum does not match the one you provided. The file may be corrupted or different from what you expected."
            ),
            EngineError::NotFound(_) => "That download no longer exists.".into(),
            EngineError::InvalidState(m) => m.clone(),
            EngineError::Stopped => "The download was stopped.".into(),
            EngineError::Other(m) => format!("Something went wrong: {m}"),
        }
    }

    pub fn to_user_error(&self) -> UserError {
        UserError {
            code: self.code().to_string(),
            message: self.user_message(),
        }
    }
}

impl From<std::io::Error> for EngineError {
    fn from(e: std::io::Error) -> Self {
        // Windows: ERROR_DISK_FULL (112), ERROR_HANDLE_DISK_FULL (39). Unix: ENOSPC (28).
        match e.raw_os_error() {
            Some(112) | Some(39) if cfg!(windows) => EngineError::DiskFull,
            Some(28) if cfg!(unix) => EngineError::DiskFull,
            _ => EngineError::Disk(e.to_string()),
        }
    }
}

impl From<reqwest::Error> for EngineError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_redirect() {
            EngineError::TooManyRedirects
        } else if e.is_builder() {
            EngineError::InvalidOption(e.to_string())
        } else {
            // Timeouts, DNS failures, resets, TLS problems, truncated bodies: all "try again".
            EngineError::Network(e.to_string())
        }
    }
}

impl From<url::ParseError> for EngineError {
    fn from(e: url::ParseError) -> Self {
        EngineError::InvalidUrl(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_classes() {
        assert_eq!(EngineError::Network("x".into()).retry_class(), RetryClass::Network);
        assert_eq!(EngineError::Http(503).retry_class(), RetryClass::Server);
        assert_eq!(EngineError::Http(429).retry_class(), RetryClass::Server);
        assert_eq!(EngineError::Http(408).retry_class(), RetryClass::Server);
        // Plain 4xx: limited retries.
        assert_eq!(EngineError::Http(404).retry_class(), RetryClass::Client);
        assert_eq!(EngineError::Http(400).retry_class(), RetryClass::Client);
        // Expired / forbidden / auth / range errors are handled elsewhere, not blindly retried.
        for s in [401, 403, 407, 410, 416] {
            assert_eq!(EngineError::Http(s).retry_class(), RetryClass::Fatal, "status {s}");
        }
        assert_eq!(EngineError::LinkExpired.retry_class(), RetryClass::Fatal);
        assert_eq!(EngineError::FileChanged.retry_class(), RetryClass::Fatal);
        assert_eq!(EngineError::DiskFull.retry_class(), RetryClass::Fatal);
        assert!(EngineError::Network("x".into()).is_retryable());
        assert!(!EngineError::DiskFull.is_retryable());
    }

    #[test]
    fn user_messages_are_plain_language() {
        let m = EngineError::Http(404).user_message();
        assert!(m.contains("not found"));
        assert!(!m.contains("HTTP status"));
    }
}
