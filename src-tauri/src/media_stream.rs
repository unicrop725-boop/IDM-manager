//! Streaming media processor (HLS .m3u8, DASH .mpd), DRM detection, ffmpeg merging & conversion, and yt-dlp resolver.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::Semaphore;
use url::Url;

/// Only plain web URLs may reach yt-dlp / ffmpeg. This blocks option injection (a "URL" such as
/// `--exec=...` is parsed by yt-dlp as a flag) and local-file / exotic-protocol inputs for ffmpeg.
pub fn validate_remote_url(url: &str) -> Result<Url, String> {
    let trimmed = url.trim();
    if trimmed.starts_with('-') {
        return Err("Invalid media URL.".to_string());
    }
    let parsed = Url::parse(trimmed).map_err(|_| "Invalid media URL.".to_string())?;
    match parsed.scheme() {
        "http" | "https" if parsed.host_str().is_some() => Ok(parsed),
        _ => Err("Only http:// and https:// media URLs are supported.".to_string()),
    }
}

pub const DRM_PROTECTED_MSG: &str = "This video is protected and cannot be downloaded.";

/// One real video quality: a resolution and frame rate that the site offers.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoOption {
    pub height: u32,
    pub fps: u32,
    pub ext: String,
    pub file_size_approx: Option<u64>,
}

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
    #[serde(default)]
    pub video_options: Vec<VideoOption>,
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
    validate_remote_url(url)?;
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
                video_options: Vec::new(),
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
            video_options: Vec::new(),
            manifest_type: if is_dash { Some("dash".into()) } else { Some("hls".into()) },
        });
    }

    // 2. Use yt-dlp sidecar
    let output = Command::new("yt-dlp")
        .args(["--dump-single-json", "--no-warnings", "--no-playlist", "--", trimmed])
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
            video_options: Vec::new(),
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
    let mut video_options: Vec<VideoOption> = Vec::new();

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
                if vcodec != "none" && height >= 144 {
                    let fps = f.get("fps").and_then(|v| v.as_f64()).map(|v| v.round() as u32).filter(|v| *v > 0).unwrap_or(30);
                    match video_options.iter_mut().find(|o| o.height == height as u32 && o.fps == fps) {
                        Some(o) => {
                            if size.unwrap_or(0) > o.file_size_approx.unwrap_or(0) {
                                o.file_size_approx = size;
                            }
                        }
                        None => video_options.push(VideoOption { height: height as u32, fps, ext: ext.clone(), file_size_approx: size }),
                    }
                }
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

    video_options.sort_by(|a, b| b.height.cmp(&a.height).then(b.fps.cmp(&a.fps)));

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
        video_options,
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

    let base_url = validate_remote_url(playlist_url)?;
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

    validate_remote_url(manifest_url)?;
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
            // A manifest may reference other inputs; only allow network protocols, never file:.
            "-protocol_whitelist",
            "http,https,tcp,tls,crypto",
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

/// Marker errors returned by `download_ytdlp_blocking` when it was stopped on purpose.
pub const YT_PAUSED: &str = "__yt_paused__";
pub const YT_CANCELLED: &str = "__yt_cancelled__";

/// Lets another thread pause or cancel a running yt-dlp download (by ending its process tree).
#[derive(Default)]
pub struct YtControl {
    pid: std::sync::atomic::AtomicU32,
    /// 0 = running, 1 = pause requested, 2 = cancel requested
    state: std::sync::atomic::AtomicU8,
}

impl YtControl {
    pub const PAUSE: u8 = 1;
    pub const CANCEL: u8 = 2;

    pub fn stop(&self, state: u8) {
        use std::sync::atomic::Ordering::SeqCst;
        self.state.store(state, SeqCst);
        let pid = self.pid.load(SeqCst);
        if pid != 0 {
            kill_process_tree(pid);
        }
    }
}

fn kill_process_tree(pid: u32) {
    let mut cmd = Command::new("taskkill");
    cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let _ = cmd.output();
}

/// Video-page sites that yt-dlp can resolve (the URL is a web page, not a file).
pub fn is_video_page_url(url: &str) -> bool {
    let Ok(u) = Url::parse(url.trim()) else { return false };
    let host = u.host_str().unwrap_or("").to_lowercase();
    let host = host.trim_start_matches("www.").trim_start_matches("m.");
    const HOSTS: &[&str] = &[
        "youtube.com", "youtu.be", "vimeo.com", "dailymotion.com", "twitch.tv", "tiktok.com",
        "instagram.com", "facebook.com", "fb.watch", "twitter.com", "x.com", "reddit.com",
    ];
    HOSTS.iter().any(|h| host == *h || host.ends_with(&format!(".{h}")))
}

/// A yt-dlp format id is only letters, digits, `_`, `-` and `.`; anything else is ignored.
fn is_safe_format_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
}

fn sanitize_stem(name: &str) -> String {
    let stem = match name.rsplit_once('.') {
        Some((s, ext)) if ext.len() <= 4 && ext.chars().all(|c| c.is_ascii_alphanumeric()) => s,
        _ => name,
    };
    let cleaned: String = stem
        .chars()
        .map(|c| if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control() { '_' } else { c })
        .collect();
    cleaned.trim().trim_end_matches('.').to_string()
}

/// Download a video page with yt-dlp (blocking). Reports `(downloaded, total, speed_bps, eta_secs)`
/// while running and returns the final file path.
pub fn download_ytdlp_blocking(
    url: &str,
    out_dir: &Path,
    temp_dir: Option<&Path>,
    name_stem: Option<&str>,
    format_id: Option<&str>,
    audio_only: bool,
    convert_to: Option<&str>,
    height: Option<u32>,
    fps: Option<u32>,
    ctl: &YtControl,
    mut on_progress: impl FnMut(u64, Option<u64>, u64, Option<u64>),
) -> Result<PathBuf, String> {
    use std::io::{BufRead, BufReader, Read};
    use std::process::Stdio;

    validate_remote_url(url)?;
    std::fs::create_dir_all(out_dir).map_err(|e| format!("Cannot create folder: {e}"))?;

    let template = match name_stem.map(sanitize_stem) {
        Some(stem) if !stem.is_empty() => format!("{stem}.%(ext)s"),
        _ => "%(title).150B [%(id)s].%(ext)s".to_string(),
    };
    let out_template = template;

    let extract_audio = matches!(convert_to, Some("mp3") | Some("m4a"));
    let selector = if extract_audio {
        "ba/b".to_string()
    } else if let Some(h) = height.filter(|h| (100..=8640).contains(h)) {
        // best stream at or below the chosen height (and frame rate), merged with the best audio
        let fps_filter = fps.filter(|f| (1..=240).contains(f)).map(|f| format!("[fps<={f}]")).unwrap_or_default();
        format!("bv*[height<={h}]{fps_filter}+ba/b[height<={h}]/b")
    } else {
        match format_id {
            Some(id) if is_safe_format_id(id) => {
                if audio_only { id.to_string() } else { format!("{id}+bestaudio/{id}") }
            }
            _ => "bv*+ba/b".to_string(),
        }
    };

    let mut cmd = Command::new("yt-dlp");
    cmd.args([
        "--no-playlist", "--no-warnings", "--newline", "--progress", "--windows-filenames", "--no-simulate",
        "--progress-template",
        "download:FGPROG %(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s",
        "--print", "after_move:FGDONE %(filepath)s",
        "-f", &selector,
        // Prefer H.264 video and AAC audio at the chosen size: they play in every Windows app,
        // while the default pick (VP9/AV1 + Opus) often has no sound or no picture in Movies & TV.
        "-S", "res,fps,vcodec:h264,acodec:aac",
        "-o", &out_template,
    ]);
    cmd.arg("-P").arg(format!("home:{}", out_dir.to_string_lossy()));
    if let Some(t) = temp_dir {
        // partial files live here, so a paused download can continue where it stopped
        cmd.arg("-P").arg(format!("temp:{}", t.to_string_lossy()));
    }
    match convert_to {
        Some("mp3") => { cmd.args(["-x", "--audio-format", "mp3", "--audio-quality", "0"]); }
        Some("m4a") => { cmd.args(["-x", "--audio-format", "m4a"]); }
        Some("mp4") => { cmd.args(["--recode-video", "mp4"]); }
        Some("mkv") => { cmd.args(["--merge-output-format", "mkv"]); }
        _ => { cmd.args(["--merge-output-format", "mp4"]); }
    }
    cmd.args(["--", url.trim()]);
    cmd.env("PYTHONIOENCODING", "utf-8").env("PYTHONUTF8", "1");
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // no console window
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("yt-dlp is not installed or not on PATH ({e}). Install it with: pip install yt-dlp"))?;

    {
        use std::sync::atomic::Ordering::SeqCst;
        ctl.pid.store(child.id(), SeqCst);
        if ctl.state.load(SeqCst) != 0 {
            kill_process_tree(child.id()); // stop was requested while starting
        }
    }

    let stderr = child.stderr.take();
    let err_thread = std::thread::spawn(move || {
        let mut buf = String::new();
        if let Some(mut e) = stderr {
            let _ = e.read_to_string(&mut buf);
        }
        buf
    });

    let mut final_path: Option<String> = None;
    if let Some(stdout) = child.stdout.take() {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(rest) = line.strip_prefix("FGPROG ") {
                let f: Vec<&str> = rest.trim().split('|').collect();
                let num = |i: usize| f.get(i).and_then(|v| v.trim().parse::<f64>().ok());
                let downloaded = num(0).unwrap_or(0.0) as u64;
                let total = num(1).or(num(2)).map(|v| v as u64);
                let speed = num(3).unwrap_or(0.0) as u64;
                let eta = num(4).map(|v| v as u64);
                on_progress(downloaded, total, speed, eta);
            } else if let Some(rest) = line.strip_prefix("FGDONE ") {
                final_path = Some(rest.trim().to_string());
            }
        }
    }

    let status = child.wait().map_err(|e| format!("yt-dlp failed: {e}"))?;
    let stderr_text = err_thread.join().unwrap_or_default();

    ctl.pid.store(0, std::sync::atomic::Ordering::SeqCst);

    if status.success() {
        if let Some(p) = final_path {
            let path = PathBuf::from(p);
            if path.exists() {
                return Ok(path);
            }
        }
        return Err("yt-dlp finished but no output file was found.".to_string());
    }

    match ctl.state.load(std::sync::atomic::Ordering::SeqCst) {
        YtControl::PAUSE => return Err(YT_PAUSED.to_string()),
        YtControl::CANCEL => return Err(YT_CANCELLED.to_string()),
        _ => {}
    }

    if check_drm(&stderr_text) {
        return Err(DRM_PROTECTED_MSG.to_string());
    }
    let last: Vec<&str> = stderr_text.lines().filter(|l| !l.trim().is_empty()).rev().take(3).collect();
    let msg = last.into_iter().rev().collect::<Vec<_>>().join(" ");
    Err(if msg.is_empty() { "yt-dlp could not download this video.".to_string() } else { msg })
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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore]
    async fn live_resolve_lists_height_and_fps() {
        let r = resolve_media("https://youtu.be/6PVKNZCpex8").await.expect("resolve");
        println!("title: {:?}", r.title);
        for o in &r.video_options {
            println!("option: {}p{} ({}) size={:?}", o.height, o.fps, o.ext, o.file_size_approx);
        }
        assert!(!r.video_options.is_empty(), "no video options");
        assert!(r.video_options.windows(2).all(|w| w[0].height >= w[1].height), "not sorted by height");
    }

    /// Download at a chosen height + fps and check the real file with ffmpeg.
    #[test]
    #[ignore]
    fn live_ytdlp_height_fps_download() {
        let dir = std::env::temp_dir().join("flowget-ytdlp-live-test2");
        let _ = std::fs::remove_dir_all(&dir);
        let path = download_ytdlp_blocking(
            "https://youtu.be/6PVKNZCpex8", &dir, None, None, None, false, None, Some(360), Some(30), &YtControl::default(), |_, _, _, _| {},
        )
        .expect("download should succeed");
        let out = std::process::Command::new("ffmpeg").arg("-i").arg(&path).output().expect("ffmpeg");
        let info = String::from_utf8_lossy(&out.stderr).to_string();
        let video_line = info.lines().find(|l| l.contains("Video:")).unwrap_or("").to_string();
        println!("{video_line}");
        assert!(video_line.contains("x360"), "expected 360p, got: {video_line}");
        let audio_line = info.lines().find(|l| l.contains("Audio:")).unwrap_or("").to_string();
        println!("{audio_line}");
        assert!(audio_line.contains("aac"), "expected AAC audio, got: {audio_line}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore]
    fn live_ytdlp_mkv_download() {
        let dir = std::env::temp_dir().join("flowget-ytdlp-live-test3");
        let _ = std::fs::remove_dir_all(&dir);
        let path = download_ytdlp_blocking(
            "https://youtu.be/6PVKNZCpex8", &dir, None, None, None, false, Some("mkv"), Some(240), Some(30), &YtControl::default(), |_, _, _, _| {},
        )
        .expect("download should succeed");
        println!("saved: {}", path.display());
        assert_eq!(path.extension().and_then(|e| e.to_str()), Some("mkv"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Pause a running download, then resume it: the second run must pick up the partial file.
    #[test]
    #[ignore]
    fn live_ytdlp_pause_and_resume() {
        use std::sync::Arc;
        let dir = std::env::temp_dir().join("flowget-ytdlp-live-test4");
        let tmp = dir.join(".tmp");
        let _ = std::fs::remove_dir_all(&dir);
        let url = "https://youtu.be/6PVKNZCpex8";

        // run 1: pause as soon as some data has arrived
        let ctl = Arc::new(YtControl::default());
        let ctl2 = ctl.clone();
        let mut at_pause = 0u64;
        let r1 = download_ytdlp_blocking(url, &dir, Some(&tmp), None, None, false, None, Some(720), Some(30), &ctl, |d, _, _, _| {
            if d > 300_000 && at_pause == 0 {
                at_pause = d;
                ctl2.stop(YtControl::PAUSE);
            }
        });
        println!("run 1: {:?}, paused at {at_pause} bytes", r1.as_ref().map(|p| p.display().to_string()));
        assert_eq!(r1.unwrap_err(), YT_PAUSED);
        let partials = std::fs::read_dir(&tmp).map(|r| r.count()).unwrap_or(0);
        println!("partial files kept: {partials}");
        assert!(partials > 0, "partial file should remain");

        // run 2: resume
        let ctl = YtControl::default();
        let mut first = None;
        let path = download_ytdlp_blocking(url, &dir, Some(&tmp), None, None, false, None, Some(720), Some(30), &ctl, |d, _, _, _| {
            if first.is_none() {
                first = Some(d);
            }
        })
        .expect("resume should finish");
        println!("run 2 first progress report: {:?} (was paused at {at_pause}); saved {}", first, path.display());
        assert!(first.unwrap_or(0) >= at_pause / 2, "resume should continue from the partial data, not restart");
        assert!(path.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Live network test (needs yt-dlp + ffmpeg on PATH): `cargo test --lib live_ytdlp -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_ytdlp_audio_download() {
        let dir = std::env::temp_dir().join("flowget-ytdlp-live-test");
        let _ = std::fs::remove_dir_all(&dir);
        let mut ticks = 0u32;
        let path = download_ytdlp_blocking(
            "https://youtu.be/6PVKNZCpex8",
            &dir,
            None,
            None,
            None,
            false,
            Some("mp3"),
            None,
            None,
            &YtControl::default(),
            |d, t, s, e| {
                ticks += 1;
                println!("progress: {d}/{t:?} speed={s} eta={e:?}");
            },
        )
        .expect("download should succeed");
        println!("saved: {}", path.display());
        assert!(path.exists());
        assert_eq!(path.extension().and_then(|e| e.to_str()), Some("mp3"));
        assert!(std::fs::metadata(&path).unwrap().len() > 100_000);
        assert!(ticks > 0, "progress callback never fired");
    }

    #[test]
    fn media_urls_must_be_plain_http() {
        assert!(validate_remote_url("https://example.com/v.m3u8").is_ok());
        assert!(validate_remote_url("  http://example.com/a  ").is_ok());
        for bad in [
            "--exec=calc.exe",
            "-o somefile",
            "file:///C:/Windows/win.ini",
            "concat:a|b",
            "ftp://example.com/x",
            "javascript:alert(1)",
            "",
            "not a url",
        ] {
            assert!(validate_remote_url(bad).is_err(), "should reject {bad:?}");
        }
    }
}
