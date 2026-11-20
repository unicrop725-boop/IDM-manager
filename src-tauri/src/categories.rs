//! Category detection and file extension mapping.

use std::path::Path;

use crate::db::Category;

pub fn detect_extension(name_or_url: &str) -> String {
    // Strip query parameters and fragments if passed a URL
    let clean = name_or_url
        .split('?')
        .next()
        .unwrap_or(name_or_url)
        .split('#')
        .next()
        .unwrap_or(name_or_url);

    let lower = clean.to_lowercase();
    // Check compound extensions first
    if lower.ends_with(".tar.gz") {
        return "tar.gz".to_string();
    }
    if lower.ends_with(".tar.bz2") {
        return "tar.bz2".to_string();
    }
    if lower.ends_with(".tar.xz") {
        return "tar.xz".to_string();
    }

    Path::new(clean)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default()
}

/// Match an extension against active categories (custom first, then built-in).
/// Returns the matched Category id, or "others" if none match.
pub fn categorize_file(name_or_url: &str, categories: &[Category]) -> String {
    let lower = name_or_url.trim().to_lowercase();
    if lower.starts_with("magnet:?") || lower.ends_with(".torrent") {
        return "torrents".to_string();
    }

    let ext = detect_extension(name_or_url);
    if ext.is_empty() {
        return "others".to_string();
    }

    // Custom categories take priority
    for cat in categories.iter().filter(|c| !c.is_builtin) {
        if cat.extensions.iter().any(|e| e.eq_ignore_ascii_case(&ext)) {
            return cat.id.clone();
        }
    }

    // Built-in categories
    for cat in categories.iter().filter(|c| c.is_builtin) {
        if cat.extensions.iter().any(|e| e.eq_ignore_ascii_case(&ext)) {
            return cat.id.clone();
        }
    }

    "others".to_string()
}
