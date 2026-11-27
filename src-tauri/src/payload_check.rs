//! Validation of download requests that arrive from outside the app (browser extension, native
//! messaging host). Pure functions, no Tauri dependency, so the small native-host executable can
//! include this file as well as the main app.

use serde_json::Value;

/// Longest URL accepted (browsers cap around 2 MB; nothing legitimate needs more than this).
pub const MAX_URL_LEN: usize = 8 * 1024;
/// Longest cookie header / user agent / other text field accepted.
pub const MAX_FIELD_LEN: usize = 64 * 1024;

const ALLOWED_SCHEMES: [&str; 6] = ["http", "https", "ftp", "ftps", "sftp", "magnet"];
const TEXT_FIELDS: [&str; 7] = ["fileName", "saveDir", "cookies", "referer", "userAgent", "mime", "action"];

/// Check that `url` is something BoltGrab is willing to download.
pub fn validate_download_url(url: &str) -> Result<(), String> {
    if url.is_empty() || url.len() > MAX_URL_LEN {
        return Err("url has an invalid length".into());
    }
    if url.starts_with('-') || url.chars().any(|c| c.is_control()) {
        return Err("url contains invalid characters".into());
    }
    let parsed = url::Url::parse(url).map_err(|_| "url is not a valid URL".to_string())?;
    let scheme = parsed.scheme();
    if !ALLOWED_SCHEMES.contains(&scheme) {
        return Err(format!("url scheme '{scheme}' is not allowed"));
    }
    if scheme != "magnet" && parsed.host_str().is_none() {
        return Err("url has no host".into());
    }
    Ok(())
}

/// Validate the JSON object sent by the extension: `url` is required and must be allowed; every
/// other known field must be a (bounded) string; `totalSize` must be a number.
pub fn validate_download_payload(v: &Value) -> Result<(), String> {
    let obj = v.as_object().ok_or("message must be a JSON object")?;
    let url = obj.get("url").and_then(Value::as_str).ok_or("missing 'url'")?;
    validate_download_url(url)?;
    for key in TEXT_FIELDS {
        match obj.get(key) {
            None | Some(Value::Null) => {}
            Some(Value::String(s)) if s.len() <= MAX_FIELD_LEN => {}
            Some(_) => return Err(format!("field '{key}' is invalid")),
        }
    }
    match obj.get("totalSize") {
        None | Some(Value::Null) => {}
        Some(Value::Number(n)) if n.is_u64() => {}
        Some(_) => return Err("field 'totalSize' is invalid".into()),
    }
    // Video quality chosen in the browser: a height / frame rate within sane bounds, audio-only, and an output kind.
    for (key, max) in [("mediaHeight", 8640u64), ("mediaFps", 240u64)] {
        match obj.get(key) {
            None | Some(Value::Null) => {}
            Some(Value::Number(n)) if n.as_u64().map_or(false, |v| (1..=max).contains(&v)) => {}
            Some(_) => return Err(format!("field '{key}' is invalid")),
        }
    }
    match obj.get("mediaAudioOnly") {
        None | Some(Value::Null) | Some(Value::Bool(_)) => {}
        Some(_) => return Err("field 'mediaAudioOnly' is invalid".into()),
    }
    match obj.get("convertTo") {
        None | Some(Value::Null) => {}
        Some(Value::String(s)) if matches!(s.as_str(), "mp4" | "mkv" | "mp3" | "m4a") => {}
        Some(_) => return Err("field 'convertTo' is invalid".into()),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn accepts_normal_requests() {
        assert!(validate_download_payload(&json!({"url": "https://example.com/a.zip", "fileName": "a.zip", "totalSize": 12})).is_ok());
        assert!(validate_download_payload(&json!({"url": "magnet:?xt=urn:btih:abc"})).is_ok());
        assert!(validate_download_payload(&json!({"url": "sftp://host/file"})).is_ok());
    }

    #[test]
    fn rejects_dangerous_or_malformed_urls() {
        for bad in ["--exec=calc", "file:///C:/Windows/win.ini", "javascript:alert(1)", "data:text/html,x", "", "http://", "https://a b/\n", "not a url"] {
            assert!(validate_download_url(bad).is_err(), "should reject {bad:?}");
        }
        assert!(validate_download_url(&format!("https://e.com/{}", "a".repeat(MAX_URL_LEN))).is_err());
    }

    #[test]
    fn video_quality_fields_are_checked() {
        let ok = json!({"url": "https://youtu.be/x", "mediaHeight": 1080, "mediaFps": 30, "mediaAudioOnly": false, "convertTo": "mp4"});
        assert!(validate_download_payload(&ok).is_ok());
        for bad in [
            json!({"url": "https://youtu.be/x", "mediaHeight": 0}),
            json!({"url": "https://youtu.be/x", "mediaHeight": 99999}),
            json!({"url": "https://youtu.be/x", "mediaHeight": "1080"}),
            json!({"url": "https://youtu.be/x", "mediaFps": -5}),
            json!({"url": "https://youtu.be/x", "mediaAudioOnly": "yes"}),
            json!({"url": "https://youtu.be/x", "convertTo": "exe"}),
        ] {
            assert!(validate_download_payload(&bad).is_err(), "should reject {bad}");
        }
    }

    #[test]
    fn rejects_bad_shapes() {
        assert!(validate_download_payload(&json!(["https://x.com"])).is_err());
        assert!(validate_download_payload(&json!({"fileName": "a"})).is_err());
        assert!(validate_download_payload(&json!({"url": 5})).is_err());
        assert!(validate_download_payload(&json!({"url": "https://x.com/a", "cookies": {"a": 1}})).is_err());
        assert!(validate_download_payload(&json!({"url": "https://x.com/a", "totalSize": "big"})).is_err());
        assert!(validate_download_payload(&json!({"url": "https://x.com/a", "cookies": "a".repeat(MAX_FIELD_LEN + 1)})).is_err());
    }
}
