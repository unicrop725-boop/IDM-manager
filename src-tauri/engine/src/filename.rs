//! File-name detection (Content-Disposition, then URL) and Windows-safe sanitising.

use percent_encoding::percent_decode_str;
use std::path::{Path, PathBuf};
use url::Url;

/// Parse the file name out of a `Content-Disposition` header value.
/// Supports `filename*=UTF-8''...` (RFC 5987/6266), quoted and bare `filename=`.
/// `filename*` wins over `filename`.
pub fn from_content_disposition(value: &str) -> Option<String> {
    let mut plain: Option<String> = None;
    let mut extended: Option<String> = None;

    for part in split_params(value).into_iter().skip(1) {
        let Some((key, val)) = part.split_once('=') else { continue };
        let key = key.trim().to_ascii_lowercase();
        let val = val.trim();
        if key == "filename*" {
            extended = decode_ext_value(val);
        } else if key == "filename" {
            plain = Some(unquote(val));
        }
    }
    extended.or(plain).map(|n| sanitize(&n)).filter(|n| !n.is_empty())
}

/// Split on `;` but not inside double quotes.
fn split_params(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut prev_backslash = false;
    for c in s.chars() {
        match c {
            '"' if !prev_backslash => {
                in_quotes = !in_quotes;
                cur.push(c);
            }
            ';' if !in_quotes => {
                out.push(std::mem::take(&mut cur));
            }
            _ => cur.push(c),
        }
        prev_backslash = c == '\\' && !prev_backslash;
    }
    out.push(cur);
    out
}

fn unquote(v: &str) -> String {
    let v = v.trim();
    if v.len() >= 2 && v.starts_with('"') && v.ends_with('"') {
        v[1..v.len() - 1].replace("\\\"", "\"").replace("\\\\", "\\")
    } else {
        v.to_string()
    }
}

/// RFC 5987 `charset'language'percent-encoded`.
fn decode_ext_value(v: &str) -> Option<String> {
    let v = v.trim().trim_matches('"');
    let mut it = v.splitn(3, '\'');
    let charset = it.next()?;
    let _lang = it.next()?;
    let encoded = it.next()?;
    let bytes: Vec<u8> = percent_decode_str(encoded).collect();
    if charset.eq_ignore_ascii_case("utf-8") {
        String::from_utf8(bytes).ok()
    } else {
        // ISO-8859-1 maps 1:1 onto the first 256 code points.
        Some(bytes.into_iter().map(|b| b as char).collect())
    }
}

/// Last path segment of the URL, percent-decoded.
pub fn from_url(url: &Url) -> Option<String> {
    let seg = url.path_segments()?.rev().find(|s| !s.is_empty())?;
    let decoded = percent_decode_str(seg).decode_utf8_lossy().to_string();
    let clean = sanitize(&decoded);
    if clean.is_empty() {
        None
    } else {
        Some(clean)
    }
}

const RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

const MAX_NAME_LEN: usize = 180;

/// Make a string safe to use as a single file name on Windows / macOS / Linux.
/// Strips any directory part (prevents `..\..\evil.exe` path traversal), replaces illegal
/// characters, avoids reserved device names, and limits the length.
pub fn sanitize(name: &str) -> String {
    // Keep only what follows the last path separator.
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");

    let mut s: String = base
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '|' | '?' | '*' => '_',
            c if (c as u32) < 32 => '_',
            c => c,
        })
        .collect();

    // Windows does not allow trailing dots / spaces, and leading spaces are a nuisance.
    s = s.trim_matches(|c: char| c == ' ' || c == '.').to_string();
    if s.is_empty() {
        return String::new();
    }

    // Reserved device names (CON, NUL, COM1, ...) with or without extension.
    let stem = s.split('.').next().unwrap_or("").to_ascii_uppercase();
    if RESERVED.contains(&stem.as_str()) {
        s = format!("_{s}");
    }

    // Length limit, preserving the extension.
    if s.chars().count() > MAX_NAME_LEN {
        let p = Path::new(&s);
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
        let stem: String = p
            .file_stem()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .chars()
            .take(MAX_NAME_LEN.saturating_sub(ext.chars().count() + 1))
            .collect();
        s = if ext.is_empty() { stem } else { format!("{stem}.{ext}") };
    }
    s
}

/// Pick a path in `dir` for `name` that does not collide. `is_taken` lets the caller also
/// exclude paths reserved by other downloads that have not created their file yet.
/// `file.zip` -> `file (1).zip` -> `file (2).zip` ...
pub fn unique_path(dir: &Path, name: &str, is_taken: &dyn Fn(&Path) -> bool) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() && !is_taken(&first) {
        return first;
    }
    let p = Path::new(name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or(name);
    let ext = p.extension().and_then(|s| s.to_str());
    for i in 1.. {
        let candidate = match ext {
            Some(e) => format!("{stem} ({i}).{e}"),
            None => format!("{stem} ({i})"),
        };
        let path = dir.join(candidate);
        if !path.exists() && !is_taken(&path) {
            return path;
        }
    }
    unreachable!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_disposition_quoted_and_bare() {
        assert_eq!(
            from_content_disposition(r#"attachment; filename="report 2024.pdf""#).as_deref(),
            Some("report 2024.pdf")
        );
        assert_eq!(
            from_content_disposition("attachment; filename=setup.exe").as_deref(),
            Some("setup.exe")
        );
    }

    #[test]
    fn content_disposition_semicolon_inside_quotes() {
        assert_eq!(
            from_content_disposition(r#"attachment; filename="a;b.txt""#).as_deref(),
            Some("a;b.txt")
        );
    }

    #[test]
    fn content_disposition_extended_wins() {
        let v = r#"attachment; filename="fallback.txt"; filename*=UTF-8''%E2%82%AC%20rates.txt"#;
        assert_eq!(from_content_disposition(v).as_deref(), Some("€ rates.txt"));
    }

    #[test]
    fn content_disposition_path_traversal_is_stripped() {
        assert_eq!(
            from_content_disposition(r#"attachment; filename="..\..\evil.exe""#).as_deref(),
            Some("evil.exe")
        );
        assert_eq!(
            from_content_disposition(r#"attachment; filename="../../etc/passwd""#).as_deref(),
            Some("passwd")
        );
    }

    #[test]
    fn name_from_url() {
        let u = Url::parse("https://example.com/files/My%20Video.mp4?token=1").unwrap();
        assert_eq!(from_url(&u).as_deref(), Some("My Video.mp4"));
        let u = Url::parse("https://example.com/").unwrap();
        assert_eq!(from_url(&u), None);
        let u = Url::parse("https://example.com/dir/").unwrap();
        assert_eq!(from_url(&u).as_deref(), Some("dir"));
    }

    #[test]
    fn sanitize_illegal_and_reserved() {
        assert_eq!(sanitize("a<b>c:d.txt"), "a_b_c_d.txt");
        assert_eq!(sanitize("CON.txt"), "_CON.txt");
        assert_eq!(sanitize("nul"), "_nul");
        assert_eq!(sanitize("  name. . "), "name");
        assert_eq!(sanitize("..."), "");
    }

    #[test]
    fn sanitize_long_name_keeps_extension() {
        let long = format!("{}.zip", "a".repeat(400));
        let s = sanitize(&long);
        assert!(s.chars().count() <= MAX_NAME_LEN);
        assert!(s.ends_with(".zip"));
    }

    #[test]
    fn unique_path_adds_counter() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.zip"), b"x").unwrap();
        std::fs::write(dir.path().join("a (1).zip"), b"x").unwrap();
        let p = unique_path(dir.path(), "a.zip", &|_| false);
        assert_eq!(p.file_name().unwrap(), "a (2).zip");
        // A reserved-but-not-yet-created path is also avoided.
        let reserved = dir.path().join("b.zip");
        let p = unique_path(dir.path(), "b.zip", &|c| c == reserved);
        assert_eq!(p.file_name().unwrap(), "b (1).zip");
    }
}
