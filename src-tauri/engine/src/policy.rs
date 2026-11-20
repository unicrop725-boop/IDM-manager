//! URL policy checks done before a download is accepted.
//!
//! Project rule 7: we do NOT bypass DRM and we do not download from DRM-protected streaming
//! services. Those links are refused up-front with a polite message.

use crate::error::EngineError;
use url::Url;

/// Streaming services whose content is DRM-protected. A host matches if it equals one of these
/// or is a sub-domain of one (`www.netflix.com`).
const DRM_HOSTS: &[&str] = &[
    "netflix.com",
    "primevideo.com",
    "hotstar.com",
    "jiohotstar.com",
    "spotify.com",
    "disneyplus.com",
    "hbomax.com",
    "max.com",
    "hulu.com",
    "peacocktv.com",
    "paramountplus.com",
    "music.apple.com",
    "tv.apple.com",
];

fn host_matches(host: &str, domain: &str) -> bool {
    host == domain || host.ends_with(&format!(".{domain}"))
}

/// Returns `Ok(())` if the URL may be downloaded.
pub fn check_url(url: &Url) -> Result<(), EngineError> {
    match url.scheme() {
        "http" | "https" => {}
        other => return Err(EngineError::UnsupportedScheme(other.to_string())),
    }
    let host = match url.host_str() {
        Some(h) => h.to_ascii_lowercase(),
        None => return Err(EngineError::InvalidUrl("the link has no website address".into())),
    };
    if DRM_HOSTS.iter().any(|d| host_matches(&host, d)) {
        return Err(EngineError::Blocked(
            "This website protects its content with DRM (copy protection), so it can't be downloaded. \
             This app does not support DRM-protected services such as Netflix, Prime Video, Hotstar or Spotify."
                .into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check(s: &str) -> Result<(), EngineError> {
        check_url(&Url::parse(s).unwrap())
    }

    #[test]
    fn allows_normal_downloads() {
        assert!(check("https://example.com/file.zip").is_ok());
        assert!(check("http://127.0.0.1:8080/a.bin").is_ok());
        // Must not match on a mere suffix without a dot boundary.
        assert!(check("https://notnetflix.com/a.zip").is_ok());
    }

    #[test]
    fn blocks_drm_services_and_subdomains() {
        assert!(matches!(check("https://www.netflix.com/watch/1"), Err(EngineError::Blocked(_))));
        assert!(matches!(check("https://netflix.com/"), Err(EngineError::Blocked(_))));
        assert!(matches!(check("https://open.spotify.com/track/1"), Err(EngineError::Blocked(_))));
        assert!(matches!(check("https://www.hotstar.com/in"), Err(EngineError::Blocked(_))));
    }

    #[test]
    fn rejects_unsupported_schemes() {
        assert!(matches!(check("ftp://example.com/a"), Err(EngineError::UnsupportedScheme(_))));
        assert!(matches!(check("file:///C:/x"), Err(EngineError::UnsupportedScheme(_))));
    }
}
