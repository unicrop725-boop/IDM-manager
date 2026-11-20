//! Site Grabber: crawls a website up to a specified depth and extracts matching file assets.

use std::collections::{HashSet, VecDeque};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrabbedAsset {
    pub url: String,
    pub file_name: String,
    pub category: String,
    pub size: Option<u64>,
    pub selected: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrabSiteRequest {
    pub url: String,
    pub depth: usize,
    pub categories: Vec<String>,
    pub custom_extensions: Option<Vec<String>>,
}

/// Match file extension against category
fn categorize_asset(name_or_url: &str) -> Option<&'static str> {
    let clean = name_or_url.split('?').next().unwrap_or(name_or_url);
    let lower = clean.to_lowercase();
    let ext = lower.split('.').last().unwrap_or("");

    match ext {
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "svg" | "bmp" | "ico" => Some("Images"),
        "mp4" | "mkv" | "webm" | "avi" | "mov" | "flv" | "wmv" | "m4v" => Some("Videos"),
        "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a" | "opus" | "wma" => Some("Music"),
        "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz" | "iso" => Some("Compressed"),
        "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "txt" | "epub" => Some("Documents"),
        "exe" | "msi" | "bin" | "dmg" => Some("Programs"),
        "apk" => Some("APKs"),
        _ => None,
    }
}

pub async fn crawl_site(req: GrabSiteRequest) -> Result<Vec<GrabbedAsset>, String> {
    let base_url = Url::parse(&req.url).map_err(|e| format!("Invalid URL: {e}"))?;
    let domain = base_url.domain().ok_or_else(|| "URL has no domain".to_string())?.to_string();

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let max_depth = req.depth.clamp(1, 3);
    let mut visited = HashSet::new();
    let mut queue = VecDeque::new();
    queue.push_back((base_url.clone(), 1usize));
    visited.insert(base_url.to_string());

    let mut discovered_urls = HashSet::new();
    let mut assets = Vec::new();

    let allowed_categories: HashSet<String> = req.categories.iter().map(|c| c.to_lowercase()).collect();
    let custom_exts: HashSet<String> = req
        .custom_extensions
        .unwrap_or_default()
        .into_iter()
        .map(|e| e.trim_start_matches('.').to_lowercase())
        .collect();

    while let Some((current_url, depth)) = queue.pop_front() {
        let resp = match client.get(current_url.as_str()).send().await {
            Ok(r) => r,
            Err(_) => continue,
        };

        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_lowercase();

        // If this URL is itself an asset (e.g. image or pdf)
        if !content_type.contains("text/html") {
            continue;
        }

        let body = match resp.text().await {
            Ok(b) => b,
            Err(_) => continue,
        };

        // Extract URLs from src="..." and href="..."
        let mut links = Vec::new();
        for marker in &["href=\"", "src=\"", "href='", "src='"] {
            let mut offset = 0;
            while let Some(start_idx) = body[offset..].find(marker) {
                let actual_start = offset + start_idx + marker.len();
                let quote = if marker.ends_with('\'') { '\'' } else { '"' };
                if let Some(end_idx) = body[actual_start..].find(quote) {
                    let link_str = body[actual_start..actual_start + end_idx].trim();
                    if !link_str.is_empty() && !link_str.starts_with('#') && !link_str.starts_with("javascript:") {
                        links.push(link_str.to_string());
                    }
                    offset = actual_start + end_idx + 1;
                } else {
                    break;
                }
            }
        }

        for raw_link in links {
            let full_url = match current_url.join(&raw_link) {
                Ok(u) => u,
                Err(_) => continue,
            };

            let full_str = full_url.to_string();
            if discovered_urls.contains(&full_str) {
                continue;
            }

            let path = full_url.path();
            let file_name = path
                .split('/')
                .filter(|s| !s.is_empty())
                .last()
                .unwrap_or("download")
                .to_string();

            // Check if matches category
            let cat_opt = categorize_asset(&file_name);
            let ext = file_name.split('.').last().unwrap_or("").to_lowercase();
            let matches_custom = custom_exts.contains(&ext);

            let is_match = match cat_opt {
                Some(cat) => allowed_categories.contains(&cat.to_lowercase()) || matches_custom,
                None => matches_custom,
            };

            if is_match && file_name.contains('.') {
                discovered_urls.insert(full_str.clone());
                assets.push(GrabbedAsset {
                    url: full_str.clone(),
                    file_name: file_name.clone(),
                    category: cat_opt.unwrap_or("Other").to_string(),
                    size: None,
                    selected: true,
                });
            } else if depth < max_depth {
                // If HTML link on same domain, explore deeper
                if let Some(link_domain) = full_url.domain() {
                    if link_domain == domain && !visited.contains(&full_str) {
                        visited.insert(full_str.clone());
                        queue.push_back((full_url, depth + 1));
                    }
                }
            }

            if assets.len() >= 500 {
                break; // Limit for UI responsiveness
            }
        }

        if assets.len() >= 500 {
            break;
        }
    }

    Ok(assets)
}
