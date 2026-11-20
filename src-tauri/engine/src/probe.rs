//! Pre-download probing: what is this file?
//!
//! 1. `HEAD` the URL. If that works, read size, `Accept-Ranges`, name, MIME type, ETag, and
//!    Last-Modified from the headers.
//! 2. If `HEAD` fails (some servers reject it), fall back to `GET` with `Range: bytes=0-0`.
//!    A `206` answer carries the total size in `Content-Range` and proves ranges work.
//! 3. If `HEAD` succeeded but did not advertise ranges, the same 1-byte ranged `GET` is used to
//!    check, because many servers support ranges without saying so.

use reqwest::header::{
    HeaderMap, ACCEPT_RANGES, ALT_SVC, CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, ETAG,
    LAST_MODIFIED, RANGE,
};
use reqwest::{Method, StatusCode};
use url::Url;

use crate::error::EngineError;
use crate::filename;
use crate::http::{send_with_auth, HttpSession, HEADER_TIMEOUT};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProbeResult {
    /// URL after following redirects.
    pub final_url: Url,
    pub total_size: Option<u64>,
    pub accepts_ranges: bool,
    pub file_name: String,
    pub mime: Option<String>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    /// Port of an HTTP/3 service on the **same host**, from `Alt-Svc: h3=":443"`.
    pub h3_port: Option<u16>,
}

/// Split on `sep`, but not inside double quotes.
fn split_unquoted(s: &str, sep: char) -> Vec<&str> {
    let mut out = Vec::new();
    let (mut start, mut in_quotes) = (0, false);
    for (i, c) in s.char_indices() {
        if c == '"' {
            in_quotes = !in_quotes;
        } else if c == sep && !in_quotes {
            out.push(&s[start..i]);
            start = i + 1;
        }
    }
    out.push(&s[start..]);
    out
}

/// Parse an `Alt-Svc` header value and return the port of an `h3` alternative on the same host.
///
/// `Alt-Svc: h3=":443"; ma=86400, h3-29=":443"` -> `Some(443)`.
/// `clear`, `ma=0` (withdrawn), another host (`h3="cdn.example:443"`), or other protocols -> `None`.
pub fn parse_alt_svc_h3(value: &str) -> Option<u16> {
    let value = value.trim();
    if value.eq_ignore_ascii_case("clear") {
        return None;
    }
    for entry in split_unquoted(value, ',') {
        let mut parts = split_unquoted(entry, ';').into_iter();
        let Some(first) = parts.next() else { continue };
        let Some((proto, authority)) = first.split_once('=') else { continue };
        if proto.trim() != "h3" {
            continue; // draft versions (h3-29, ...) and h2 / quic are not what we speak
        }
        let authority = authority.trim().trim_matches('"');
        let Some((host, port)) = authority.rsplit_once(':') else { continue };
        if !host.is_empty() {
            continue; // an alternative on a different host: not supported
        }
        let Ok(port) = port.parse::<u16>() else { continue };
        let withdrawn = parts.any(|p| p.trim().replace(' ', "").eq_ignore_ascii_case("ma=0"));
        if !withdrawn {
            return Some(port);
        }
    }
    None
}

fn alt_svc_h3(h: &HeaderMap) -> Option<u16> {
    // A server may send several Alt-Svc headers.
    h.get_all(ALT_SVC)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .find_map(parse_alt_svc_h3)
}

fn header_str(h: &HeaderMap, name: reqwest::header::HeaderName) -> Option<String> {
    h.get(name).map(|v| String::from_utf8_lossy(v.as_bytes()).trim().to_string())
}

fn content_length(h: &HeaderMap) -> Option<u64> {
    header_str(h, CONTENT_LENGTH)?.parse().ok()
}

/// Total size from `Content-Range: bytes 0-0/12345` (or `bytes */12345`).
pub fn parse_content_range_total(value: &str) -> Option<u64> {
    value.rsplit('/').next()?.trim().parse().ok()
}

/// Start offset from `Content-Range: bytes 100-199/1000`.
pub fn parse_content_range_start(value: &str) -> Option<u64> {
    let range = value.trim().strip_prefix("bytes")?.trim();
    range.split('-').next()?.trim().parse().ok()
}

fn mime_of(h: &HeaderMap) -> Option<String> {
    header_str(h, CONTENT_TYPE).map(|v| v.split(';').next().unwrap_or("").trim().to_ascii_lowercase()).filter(|m| !m.is_empty())
}

fn name_of(h: &HeaderMap, final_url: &Url) -> String {
    header_str(h, CONTENT_DISPOSITION)
        .and_then(|cd| filename::from_content_disposition(&cd))
        .or_else(|| filename::from_url(final_url))
        .unwrap_or_else(|| "download".to_string())
}

/// Probe `url`. Authentication challenges are answered if credentials were supplied.
pub async fn probe(session: &HttpSession, url: &Url) -> Result<ProbeResult, EngineError> {
    let client = session.client()?;

    // --- Step 1: HEAD ---------------------------------------------------------------------
    if let Ok(resp) = send_with_auth(session, &client, Method::HEAD, url, None, HEADER_TIMEOUT, |rb| rb).await {
        if resp.status().is_success() {
            let h = resp.headers();
            let final_url = resp.url().clone();
            let mut accepts_ranges = header_str(h, ACCEPT_RANGES)
                .map(|v| v.to_ascii_lowercase().contains("bytes"))
                .unwrap_or(false);
            let mut total_size = content_length(h);
            let result_name = name_of(h, &final_url);
            let mime = mime_of(h);
            let etag = header_str(h, ETAG);
            let last_modified = header_str(h, LAST_MODIFIED);
            let h3_port = alt_svc_h3(h);

            // HEAD did not tell us everything (no Accept-Ranges header, or no Content-Length, which
            // CDNs often omit on HEAD): ask for one byte with a Range header and see. A 206 proves
            // ranges work and its Content-Range carries the total size. (An empty file is known to be
            // empty, so there is nothing to test.)
            if (!accepts_ranges || total_size.is_none()) && total_size != Some(0) {
                if let Ok((status, rh)) = ranged_get(session, &client, &final_url).await {
                    if status == StatusCode::PARTIAL_CONTENT {
                        accepts_ranges = true;
                        if let Some(t) = header_str(&rh, CONTENT_RANGE).and_then(|v| parse_content_range_total(&v)) {
                            total_size = Some(t);
                        }
                    } else if status.is_success() && total_size.is_none() {
                        // The server ignored Range and answered with the whole file: at least the
                        // length is known now.
                        total_size = content_length(&rh);
                    }
                }
            }
            return Ok(ProbeResult {
                final_url,
                total_size,
                accepts_ranges,
                file_name: result_name,
                mime,
                etag,
                last_modified,
                h3_port,
            });
        }
        // Non-success HEAD (405, 403, 404...): servers often mishandle HEAD, so fall through.
    }

    // --- Step 2: GET with Range: bytes=0-0 --------------------------------------------------
    let resp = send_with_auth(session, &client, Method::GET, url, None, HEADER_TIMEOUT, |rb| rb.header(RANGE, "bytes=0-0")).await?;
    let status = resp.status();
    let final_url = resp.url().clone();
    let h = resp.headers().clone();
    // We only wanted the headers; dropping the response closes the connection without
    // downloading a (possibly huge) body.
    drop(resp);

    let (total_size, accepts_ranges) = match status {
        StatusCode::PARTIAL_CONTENT => (
            header_str(&h, CONTENT_RANGE).and_then(|v| parse_content_range_total(&v)),
            true,
        ),
        // Server ignored the Range header and is sending the whole file.
        s if s.is_success() => (content_length(&h), false),
        // Empty file: a range starting at 0 is "not satisfiable".
        StatusCode::RANGE_NOT_SATISFIABLE => (Some(0), false),
        s => return Err(EngineError::Http(s.as_u16())),
    };

    Ok(ProbeResult {
        file_name: name_of(&h, &final_url),
        mime: mime_of(&h),
        etag: header_str(&h, ETAG),
        last_modified: header_str(&h, LAST_MODIFIED),
        h3_port: alt_svc_h3(&h),
        final_url,
        total_size,
        accepts_ranges,
    })
}

async fn ranged_get(
    session: &HttpSession,
    client: &reqwest::Client,
    url: &Url,
) -> Result<(StatusCode, HeaderMap), EngineError> {
    let resp =
        send_with_auth(session, client, Method::GET, url, None, HEADER_TIMEOUT, |rb| rb.header(RANGE, "bytes=0-0")).await?;
    let out = (resp.status(), resp.headers().clone());
    drop(resp);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alt_svc_finds_an_h3_service_on_the_same_host() {
        assert_eq!(parse_alt_svc_h3(r#"h3=":443"; ma=86400"#), Some(443));
        assert_eq!(parse_alt_svc_h3(r#"h3=":8443""#), Some(8443));
        // Cloudflare-style: several entries, final h3 plus drafts.
        assert_eq!(parse_alt_svc_h3(r#"h3-29=":443"; ma=86400, h3=":443"; ma=86400"#), Some(443));
        // A comma inside the quoted authority must not split the entry.
        assert_eq!(parse_alt_svc_h3(r#"h2="a,b:443", h3=":443""#), Some(443));
        assert_eq!(parse_alt_svc_h3(r#"h3 = ":443" ; ma = 60"#), Some(443));
    }

    #[test]
    fn alt_svc_ignores_everything_we_cannot_or_must_not_use() {
        assert_eq!(parse_alt_svc_h3("clear"), None);
        assert_eq!(parse_alt_svc_h3(r#"h3=":443"; ma=0"#), None, "ma=0 withdraws the alternative");
        assert_eq!(parse_alt_svc_h3(r#"h3="cdn.example.net:443""#), None, "different host");
        assert_eq!(parse_alt_svc_h3(r#"h3-29=":443"; ma=86400"#), None, "draft version only");
        assert_eq!(parse_alt_svc_h3(r#"h2=":443""#), None);
        assert_eq!(parse_alt_svc_h3(r#"h3=":notaport""#), None);
        assert_eq!(parse_alt_svc_h3(""), None);
        assert_eq!(parse_alt_svc_h3("garbage"), None);
    }

    #[test]
    fn content_range_parsing() {
        assert_eq!(parse_content_range_total("bytes 0-0/12345"), Some(12345));
        assert_eq!(parse_content_range_total("bytes */777"), Some(777));
        assert_eq!(parse_content_range_total("bytes 0-0/*"), None);
        assert_eq!(parse_content_range_start("bytes 100-199/1000"), Some(100));
        assert_eq!(parse_content_range_start("bytes 5368709120-5368709999/9999999999"), Some(5_368_709_120));
        assert_eq!(parse_content_range_start("garbage"), None);
    }
}
