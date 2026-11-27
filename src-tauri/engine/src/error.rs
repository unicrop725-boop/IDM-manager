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
    /// The site's HTTPS certificate is not trusted (expired, self-signed, wrong name). Retrying cannot help.
    #[error("untrusted certificate: {0}")]
    Certificate(String),
    /// The website's name could not be looked up.
    #[error("dns lookup failed: {0}")]
    Dns(String),
    /// The server did not answer in time.
    #[error("timed out: {0}")]
    Timeout(String),
    /// The server (or a firewall) actively refused the connection.
    #[error("connection refused: {0}")]
    Refused(String),
    /// The server answered with a web page (a login or error page) instead of the file.
    #[error("the server returned a web page instead of the file")]
    WrongFile,
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
    /// Known before any byte is written: the file is bigger than the free space of the target drive.
    #[error("not enough disk space: {needed} bytes needed, {free} free on {drive}")]
    NotEnoughSpace { needed: u64, free: u64, drive: String },
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
            EngineError::Network(_) | EngineError::Dns(_) | EngineError::Timeout(_) | EngineError::Refused(_) => {
                RetryClass::Network
            }
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
            EngineError::Certificate(_) => "certificate",
            EngineError::Dns(_) => "dns",
            EngineError::Timeout(_) => "timeout",
            EngineError::Refused(_) => "refused",
            EngineError::WrongFile => "wrong_file",
            EngineError::TooManyRedirects => "too_many_redirects",
            EngineError::Http(_) => "http",
            EngineError::AuthFailed => "auth_failed",
            EngineError::FileChanged => "file_changed",
            EngineError::LinkExpired => "link_expired",
            EngineError::RangeIgnored => "resume_unsupported",
            EngineError::Disk(_) => "disk",
            EngineError::DiskFull => "disk_full",
            EngineError::NotEnoughSpace { .. } => "not_enough_space",
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
            EngineError::Certificate(_) => {
                "This site's security certificate is not valid (expired, self-signed or issued for another address), so BoltGrab will not download from it. Check the address, and that the date and time on this PC are right. If you trust the site, ask its owner to fix the certificate.".into()
            }
            EngineError::Dns(_) => {
                "The website's address could not be found. Check the link for typing mistakes and that your internet works, then press Resume.".into()
            }
            EngineError::Timeout(_) => {
                "The server did not answer in time. It may be busy or your connection is slow. Press Resume to try again.".into()
            }
            EngineError::Refused(_) => {
                "The server refused the connection. It may be down, or a firewall, VPN or proxy is blocking it. Check those, then press Resume.".into()
            }
            EngineError::WrongFile => {
                "The server sent a web page instead of the file. This usually means the site needs you to sign in or the link has expired. Open the link in your browser, sign in, then download it from there with the BoltGrab extension. If you really want the page itself, rename the file to end in .html.".into()
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
            EngineError::NotEnoughSpace { needed, free, drive } => format!(
                "This file needs {} but drive {drive} has only {} free. Free some space (Disk Cleaner can help), then press Resume.",
                crate::diskspace::human_bytes(*needed),
                crate::diskspace::human_bytes(*free)
            ),
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
            classify_transport(&e)
        }
    }
}

/// Turn a transport failure into the most specific error, so the message can say what to do.
fn classify_transport(e: &reqwest::Error) -> EngineError {
    // The useful detail is usually deep in the chain of causes.
    let mut text = e.to_string();
    let mut src = std::error::Error::source(e);
    while let Some(s) = src {
        text.push_str(" | ");
        text.push_str(&s.to_string());
        src = s.source();
    }
    classify_transport_text(&text, e.is_timeout())
}

fn classify_transport_text(text: &str, timed_out: bool) -> EngineError {
    let t = text.to_ascii_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|n| t.contains(n));
    if has(&[
        "certificate",
        "cert_e_",
        "sec_e_untrusted_root",
        "sec_e_cert",
        "unknown ca",
        "unknownissuer",
        "invalid peer certificate",
        "self signed",
        "self-signed",
    ]) {
        EngineError::Certificate(text.to_string())
    } else if has(&["dns error", "failed to lookup", "no such host", "os error 11001", "name or service not known", "nodename nor servname"]) {
        EngineError::Dns(text.to_string())
    } else if has(&["connection refused", "os error 10061", "actively refused"]) {
        EngineError::Refused(text.to_string())
    } else if timed_out || has(&["timed out", "os error 10060"]) {
        EngineError::Timeout(text.to_string())
    } else {
        // Resets, truncated bodies and the like: "try again".
        EngineError::Network(text.to_string())
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
    fn transport_failures_get_a_specific_reason() {
        let c = |t: &str, to: bool| classify_transport_text(t, to);
        assert!(matches!(c("error sending request | invalid peer certificate: UnknownIssuer", false), EngineError::Certificate(_)));
        assert!(matches!(c("client error (Connect) | SEC_E_UNTRUSTED_ROOT", false), EngineError::Certificate(_)));
        assert!(matches!(c("dns error: failed to lookup address information", false), EngineError::Dns(_)));
        assert!(matches!(c("tcp connect error: No connection could be made because the target machine actively refused it. (os error 10061)", false), EngineError::Refused(_)));
        assert!(matches!(c("operation timed out", false), EngineError::Timeout(_)));
        assert!(matches!(c("whatever", true), EngineError::Timeout(_)));
        assert!(matches!(c("connection reset by peer", false), EngineError::Network(_)));
        // A bad certificate is final; the rest of the network errors keep their retry behaviour.
        assert_eq!(EngineError::Certificate("x".into()).retry_class(), RetryClass::Fatal);
        assert_eq!(EngineError::Dns("x".into()).retry_class(), RetryClass::Network);
        assert_eq!(EngineError::WrongFile.retry_class(), RetryClass::Fatal);
        assert!(EngineError::WrongFile.user_message().contains("sign in"));
    }

    #[test]
    fn user_messages_are_plain_language() {
        let m = EngineError::Http(404).user_message();
        assert!(m.contains("not found"));
        assert!(!m.contains("HTTP status"));
    }
}
