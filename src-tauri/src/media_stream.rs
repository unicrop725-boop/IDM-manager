//! Streaming media processor (HLS .m3u8, DASH .mpd), DRM detection, ffmpeg merging & conversion, and yt-dlp resolver.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::Semaphore;
use url::Url;

pub const DRM_PROTECTED_MSG: &str = "This video is protected and cannot be downloaded.";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaFormatOption {
    pub format_id: String,
    pub quality_label: String,
    pub resolution: Option<String>,
    pub ext: String,
    pub file_size_approx: Option<u64>,
    pub is_audio_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaResolveResult {
    pub is_supported: bool,
    pub is_drm: bool,
    pub drm_message: Option<String>,
    pub title: Option<String>,
    pub thumbnail: Option<String>,
    pub duration: Option<f64>,
    pub formats: Vec<MediaFormatOption>,
    pub manifest_type: Option<String>,
}

/// Detect DRM protections in manifest content or error output.
pub fn check_drm(content: &str) -> bool {
    let lower = content.to_lowercase();
    // Widevine UUID: edef8ba9-79d6-4ace-a3c8-27dcd51d21ed
    // PlayReady UUID: 9a04f079-9840-4286-ab92-e65be0f77f24
    // FairPlay: com.apple.streamingkeydelivery or skd://
    lower.contains("edef8ba9-79d6-4ace-a3c8-27dcd51d21ed")
        || lower.contains("9a04f079-9840-4286-ab92-e65be0f77f24")
        || lower.contains("com.apple.streamingkeydelivery")
        || lower.contains("skd://")
        || lower.contains("sample-aes")
        || lower.contains("widevine")
        || lower.contains("playready")
        || lower.contains("drm protected")
        || lower.contains("this video is drm protected")
}

/// Resolve video metadata and available qualities using bundled yt-dlp or direct manifest inspection.
pub async fn resolve_media(url: &str) -> Result<MediaResolveResult, String> {
    let trimmed = url.trim();
    let lower = trimmed.to_lowercase();

    // 1. Direct HLS or DASH stream inspection
    if lower.contains(".m3u8") || lower.contains(".mpd") {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|e| e.to_string())?;

        let resp = client.get(trimmed).send().await.map_err(|e| e.to_string())?;
        let text = resp.text().await.map_err(|e| e.to_string())?;

        if check_drm(&text) {
            return Ok(MediaResolveResult {
                is_supported: true,
                is_drm: true,
                drm_message: Some(DRM_PROTECTED_MSG.to_string()),
                title: None,
                thumbnail: None,
                duration: None,
                formats: Vec::new(),
                manifest_type: if lower.contains(".mpd") { Some("dash".into()) } else { Some("hls".into()) },
            });
        }

        let is_dash = lower.contains(".mpd");
        let format_label = if is_dash { "DASH Stream (Best Quality)" } else { "HLS Stream (Best Quality)" };
        return Ok(MediaResolveResult {
            is_supported: true,
            is_drm: false,
            drm_message: None,
            title: Some("Streaming Media".to_string()),
            thumbnail: None,
            duration: None,
            formats: vec![
                MediaFormatOption {
                    format_id: "best".to_string(),
                    quality_label: format_label.to_string(),
                    resolution: Some("Auto".to_string()),
                    ext: "mp4".to_string(),
                    file_size_approx: None,
                    is_audio_only: false,
                },
                MediaFormatOption {
                    format_id: "audio".to_string(),
                    quality_label: "Audio Only (Extracted MP3)".to_string(),
                    resolution: None,
                    ext: "mp3".to_string(),
                    file_size_approx: None,
                    is_audio_only: true,
                },
            ],
            manifest_type: if is_dash { Some("dash".into()) } else { Some("hls".into()) },
        });
    }

    // 2. Use yt-dlp sidecar
    let output = Command::new("yt-dlp")
        .args(["--dump-single-json", "--no-warnings", "--no-playlist", trimmed])
        .output();

    let output = match output {
        Ok(out) => out,
        Err(e) => {
            return Err(format!("yt-dlp is not available: {e}"));
        }
    };

    let stderr = String::from_utf8_lossy(&output.stderr);
    if check_drm(&stderr) {
        return Ok(MediaResolveResult {
            is_supported: true,
            is_drm: true,
            drm_message: Some(DRM_PROTECTED_MSG.to_string()),
            title: None,
            thumbnail: None,
            duration: None,
            formats: Vec::new(),
            manifest_type: None,
        });
    }

    if !output.status.success() {
        return Err(format!("Could not resolve video page: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&stdout).map_err(|e| format!("Invalid JSON from yt-dlp: {e}"))?;

    let title = json.get("title").and_then(|v| v.as_str()).map(String::from);
    let thumbnail = json.get("thumbnail").and_then(|v| v.as_str()).map(String::from);
    let duration = json.get("duration").and_then(|v| v.as_f64());

    let mut formats = Vec::new();
    let mut seen_qualities = std::collections::HashSet::new();

    // Standard qualities to display
    if let Some(formats_arr) = json.get("formats").and_then(|v| v.as_array()) {
        for f in formats_arr {
            let vcodec = f.get("vcodec").and_then(|v| v.as_str()).unwrap_or("none");
            let acodec = f.get("acodec").and_then(|v| v.as_str()).unwrap_or("none");
            let height = f.get("height").and_then(|v| v.as_u64()).unwrap_or(0);
            let format_id = f.get("format_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let ext = f.get("ext").and_then(|v| v.as_str()).unwrap_or("mp4").to_string();
            let size = f.get("filesize").and_then(|v| v.as_u64()).or_else(|| f.get("filesize_approx").and_then(|v| v.as_u64()));

            if vcodec == "none" && acodec != "none" {
                if !seen_qualities.contains("audio") {
                    seen_qualities.insert("audio");
                    formats.push(MediaFormatOption {
                        format_id: format_id.clone(),
                        quality_label: "Audio Only (Best Quality)".to_string(),
                        resolution: None,
                        ext: "mp3".to_string(),
                        file_size_approx: size,
                        is_audio_only: true,
                    });
                }
            } else if height > 0 {
                let quality_label = match height {
                    h if h >= 2160 => "4K (2160p)",
                    h if h >= 1440 => "2K (1440p)",
                    h if h >= 1080 => "1080p Full HD",
                    h if h >= 720 => "720p HD",
                    h if h >= 480 => "480p SD",
                    h if h >= 360 => "360p",
                    _ => "240p",
                };

                if !seen_qualities.contains(quality_label) {
                    seen_qualities.insert(quality_label);
                    formats.push(MediaFormatOption {
                        format_id: format_id.clone(),
                        quality_label: quality_label.to_string(),
                        resolution: Some(format!("{}p", height)),
                        ext,
                        file_size_approx: size,
                        is_audio_only: false,
                    });
                }
            }
        }
    }

    if formats.is_empty() {
        formats.push(MediaFormatOption {
            format_id: "best".to_string(),
            quality_label: "Best Video Quality".to_string(),
            resolution: Some("Auto".to_string()),
            ext: "mp4".to_string(),
            file_size_approx: None,
            is_audio_only: false,
        });
    }

    Ok(MediaResolveResult {
        is_supported: true,
        is_drm: false,
        drm_message: None,
        title,
        thumbnail,
        duration,
        formats,
        manifest_type: None,
    })
}

/// Download HLS stream (.m3u8) by fetching segments in parallel and merging via ffmpeg without re-encoding.
pub async fn download_hls(
    playlist_url: &str,
    output_file: &Path,
    convert_to: Option<&str>,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let base_url = Url::parse(playlist_url).map_err(|e| format!("Invalid playlist URL: {e}"))?;
    let resp = client.get(playlist_url).send().await.map_err(|e| e.to_string())?;
    let playlist_text = resp.text().await.map_err(|e| e.to_string())?;

    if check_drm(&playlist_text) {
        return Err(DRM_PROTECTED_MSG.to_string());
    }

    // Parse segment URIs
    let mut segment_urls = Vec::new();
    for line in playlist_text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let seg_url = base_url.join(trimmed).map_err(|e| format!("Segment URL error: {e}"))?;
        segment_urls.push(seg_url);
    }

    if segment_urls.is_empty() {
        // Might be a master playlist: find the first sub-playlist
        for line in playlist_text.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            if let Ok(sub_url) = base_url.join(trimmed) {
                return Box::pin(download_hls(sub_url.as_str(), output_file, convert_to)).await;
            }
        }
        return Err("No media segments found in HLS playlist".to_string());
    }

    let temp_dir = tempfile::tempdir().map_err(|e| format!("Temp dir error: {e}"))?;
    let temp_path = temp_dir.path();

    // Parallel segment download with concurrency limiter (8 connections)
    let sem = Arc::new(Semaphore::new(8));
    let mut tasks = Vec::new();

    for (i, seg_url) in segment_urls.iter().enumerate() {
        let permit = sem.clone().acquire_owned().await.map_err(|e| e.to_string())?;
        let client_clone = client.clone();
        let seg_url_clone = seg_url.clone();
        let seg_file_path = temp_path.join(format!("seg_{:05}.ts", i));

        tasks.push(tokio::spawn(async move {
            let _permit = permit;
            let resp = client_clone.get(seg_url_clone.as_str()).send().await.map_err(|e| e.to_string())?;
            let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
            tokio::fs::write(&seg_file_path, &bytes).await.map_err(|e| e.to_string())?;
            Ok::<PathBuf, String>(seg_file_path)
        }));
    }

    let mut segment_files = Vec::new();
    for t in tasks {
        let path = t.await.map_err(|e| format!("Task join error: {e}"))??;
        segment_files.push(path);
    }

    // Write concat file for ffmpeg
    let concat_file = temp_path.join("concat.txt");
    let mut concat_content = String::new();
    for f in &segment_files {
        let file_name = f.file_name().unwrap().to_string_lossy();
        concat_content.push_str(&format!("file '{}'\n", file_name));
    }
    tokio::fs::write(&concat_file, concat_content).await.map_err(|e| e.to_string())?;

    // Output target
    let target_mp4 = if convert_to.is_some() {
        temp_path.join("merged_raw.mp4")
    } else {
        output_file.to_path_buf()
    };

    // Run ffmpeg concat without re-encoding
    let status = Command::new("ffmpeg")
        .args([
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            &concat_file.to_string_lossy(),
            "-c",
            "copy",
            &target_mp4.to_string_lossy(),
        ])
        .status()
        .map_err(|e| format!("Failed to run ffmpeg: {e}"))?;

    if !status.success() {
        return Err("ffmpeg concat failed".to_string());
    }

    // Convert to MP3 or M4A if requested
    if let Some(format) = convert_to {
        let format_lower = format.to_lowercase();
        let convert_status = match format_lower.as_str() {
            "mp3" => Command::new("ffmpeg")
                .args([
                    "-y",
                    "-i",
                    &target_mp4.to_string_lossy(),
                    "-vn",
                    "-b:a",
                    "320k",
                    &output_file.to_string_lossy(),
                ])
                .status(),
            "m4a" => Command::new("ffmpeg")
                .args([
                    "-y",
                    "-i",
                    &target_mp4.to_string_lossy(),
                    "-vn",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "256k",
                    &output_file.to_string_lossy(),
                ])
                .status(),
            _ => Command::new("ffmpeg")
                .args([
                    "-y",
                    "-i",
                    &target_mp4.to_string_lossy(),
                    "-c",
                    "copy",
                    &output_file.to_string_lossy(),
                ])
                .status(),
        };

        if let Ok(st) = convert_status {
            if !st.success() {
                return Err(format!("ffmpeg conversion to {format} failed"));
            }
        }
    }

    Ok(())
}

/// Download DASH stream (.mpd) with ffmpeg copy merging without re-encoding.
pub async fn download_dash(
    manifest_url: &str,
    output_file: &Path,
    convert_to: Option<&str>,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client.get(manifest_url).send().await.map_err(|e| e.to_string())?;
    let manifest_text = resp.text().await.map_err(|e| e.to_string())?;

    if check_drm(&manifest_text) {
        return Err(DRM_PROTECTED_MSG.to_string());
    }

    // Use ffmpeg to ingest DASH stream directly and copy without re-encoding
    let temp_dir = tempfile::tempdir().map_err(|e| format!("Temp dir error: {e}"))?;
    let temp_mp4 = temp_dir.path().join("dash_merged.mp4");

    let status = Command::new("ffmpeg")
        .args([
            "-y",
            "-i",
            manifest_url,
            "-c",
            "copy",
            &temp_mp4.to_string_lossy(),
        ])
        .status()
        .map_err(|e| format!("ffmpeg execution error: {e}"))?;

    if !status.success() {
        return Err("ffmpeg DASH stream download failed".to_string());
    }

    if let Some(format) = convert_to {
        let format_lower = format.to_lowercase();
        if format_lower == "mp3" {
            let conv = Command::new("ffmpeg")
                .args([
                    "-y",
                    "-i",
                    &temp_mp4.to_string_lossy(),
                    "-vn",
                    "-b:a",
                    "320k",
                    &output_file.to_string_lossy(),
                ])
                .status();
            if let Ok(st) = conv {
                if !st.success() {
                    return Err("ffmpeg MP3 conversion failed".to_string());
                }
            }
            return Ok(());
        }
    }

    // Move to final destination
    tokio::fs::copy(&temp_mp4, output_file).await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Auto-update yt-dlp in the background
pub async fn auto_update_ytdlp() -> Result<String, String> {
    tokio::task::spawn_blocking(|| {
        let output = Command::new("python")
            .args(["-m", "pip", "install", "--upgrade", "yt-dlp"])
            .output();

        match output {
            Ok(out) => {
                let msg = String::from_utf8_lossy(&out.stdout).to_string();
                Ok(msg)
            }
            Err(e) => Err(format!("Failed to auto-update yt-dlp: {e}")),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
