//! The video engine (yt-dlp) and media converter (ffmpeg), installed and kept up to date by BoltGrab itself, so
//! nobody has to edit PATH. Their real names must never be shown to the user: use `friendly_name` / `scrub`.
//!
//! The programs live in `%APPDATA%\com.flowget.app\tools`. That folder is put in front of the process's PATH at start,
//! so every program BoltGrab launches (and yt-dlp, which looks for ffmpeg) finds the managed copies first and falls back
//! to anything the user installed themselves. Downloads are checked against the SHA-256 the publisher lists.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

const YTDLP_SUMS_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS";
const YTDLP_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
const FFMPEG_URL: &str = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
const FFMPEG_SHA_URL: &str = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip.sha256";
/// How often the managed yt-dlp is refreshed in the background (sites change often, so it goes stale quickly).
const AUTO_UPDATE_AFTER_SECS: i64 = 7 * 24 * 3600;

static APP: OnceLock<AppHandle> = OnceLock::new();
/// One install or update at a time, however many downloads ask for the tools at once.
static INSTALL_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub fn init(app: AppHandle) {
    let _ = APP.set(app);
}

/// Where the managed copies live.
pub fn dir() -> PathBuf {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("com.flowget.app")
        .join("tools")
}

/// Put the tools folder first on PATH for this process and everything it starts.
pub fn prepend_to_path() {
    let tools = dir();
    let _ = std::fs::create_dir_all(&tools);
    let old = std::env::var_os("PATH").unwrap_or_default();
    let mut paths = vec![tools];
    paths.extend(std::env::split_paths(&old));
    if let Ok(joined) = std::env::join_paths(paths) {
        std::env::set_var("PATH", joined);
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    pub name: String,
    pub installed: bool,
    /// "BoltGrab" (managed copy), "System" (found on PATH) or "Missing".
    pub source: String,
    pub version: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    tool: String,
    /// checking | downloading | verifying | extracting | done | error
    stage: String,
    downloaded: u64,
    total: u64,
    message: String,
}

fn emit(tool: &str, stage: &str, downloaded: u64, total: u64, message: &str) {
    if let Some(app) = APP.get() {
        let _ = app.emit(
            "tools-progress",
            Progress { tool: tool.into(), stage: stage.into(), downloaded, total, message: message.into() },
        );
    }
}

/// The first `name.exe` on PATH, and whether it is the managed copy.
pub fn find(name: &str) -> Option<(PathBuf, bool)> {
    let exe = format!("{name}.exe");
    let managed = dir().join(&exe);
    if managed.is_file() {
        return Some((managed, true));
    }
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).map(|d| d.join(&exe)).find(|p| p.is_file()).map(|p| (p, false))
}

/// Stop Windows from opening a console window for a helper program we launch.
pub fn hide_window(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

fn version_of(path: &Path, name: &str) -> Option<String> {
    let arg = if name == "ffmpeg" { "-version" } else { "--version" };
    let out = hide_window(&mut Command::new(path)).arg(arg).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let line = text.lines().next()?.trim();
    if line.is_empty() {
        return None;
    }
    // "ffmpeg version 7.1-essentials_build-www.gyan.dev Copyright ..." -> "7.1-essentials_build-www.gyan.dev"
    Some(if name == "ffmpeg" { line.split_whitespace().nth(2).unwrap_or(line).to_string() } else { line.to_string() })
}

/// What is installed (runs each program once to read its version, so call it off the UI thread).
pub fn status() -> Vec<ToolInfo> {
    ["yt-dlp", "ffmpeg"]
        .iter()
        .map(|name| match find(name) {
            Some((path, managed)) => ToolInfo {
                name: name.to_string(),
                installed: true,
                source: if managed { "BoltGrab" } else { "System" }.into(),
                version: version_of(&path, name),
                path: Some(path.to_string_lossy().into_owned()),
            },
            None => ToolInfo { name: name.to_string(), installed: false, source: "Missing".into(), version: None, path: None },
        })
        .collect()
}

/// The hash for `file` in a checksum list (`<hash>  <file>`, `<hash> *<file>`), or the only hash in a one-line file.
pub fn parse_checksum(text: &str, file: &str) -> Option<String> {
    let is_hash = |s: &str| s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit());
    let lines: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    for l in &lines {
        let mut parts = l.split_whitespace();
        let (Some(h), Some(name)) = (parts.next(), parts.next()) else { continue };
        if is_hash(h) && name.trim_start_matches('*') == file {
            return Some(h.to_ascii_lowercase());
        }
    }
    if lines.len() == 1 {
        let h = lines[0].split_whitespace().next()?;
        if is_hash(h) {
            return Some(h.to_ascii_lowercase());
        }
    }
    None
}

fn sha256_file(path: &Path) -> std::io::Result<String> {
    use std::io::Read;
    let mut f = std::fs::File::open(path)?;
    let mut ctx = ring::digest::Context::new(&ring::digest::SHA256);
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        ctx.update(&buf[..n]);
    }
    Ok(hex(ctx.finish().as_ref()))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("BoltGrab")
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())
}

async fn fetch_text(url: &str) -> Result<String, String> {
    let resp = client()?.get(url).timeout(Duration::from_secs(30)).send().await.map_err(net_err)?;
    if !resp.status().is_success() {
        return Err(format!("The download site answered {} ({url}).", resp.status()));
    }
    resp.text().await.map_err(net_err)
}

fn net_err(e: reqwest::Error) -> String {
    format!("Could not reach the download site. Check your internet connection and try again. ({e})")
}

/// Download `url` to `dest`, reporting progress, and return its SHA-256.
async fn download_to(url: &str, dest: &Path, tool: &str) -> Result<String, String> {
    let mut resp = client()?.get(url).send().await.map_err(net_err)?;
    if !resp.status().is_success() {
        return Err(format!("The download site answered {} ({url}).", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut file = tokio::fs::File::create(dest).await.map_err(|e| format!("Could not write {}: {e}", dest.display()))?;
    let mut ctx = ring::digest::Context::new(&ring::digest::SHA256);
    let (mut done, mut last) = (0u64, Instant::now());
    while let Some(chunk) = resp.chunk().await.map_err(net_err)? {
        ctx.update(&chunk);
        file.write_all(&chunk).await.map_err(|e| format!("Could not write {}: {e}", dest.display()))?;
        done += chunk.len() as u64;
        if last.elapsed() >= Duration::from_millis(250) {
            emit(tool, "downloading", done, total, "");
            last = Instant::now();
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    emit(tool, "downloading", done, total.max(done), "");
    Ok(hex(ctx.finish().as_ref()))
}

/// Replace `target` with `new`, even when the old file is a running program (Windows allows renaming it).
fn swap_in(new: &Path, target: &Path) -> Result<(), String> {
    let old = target.with_extension("exe.old");
    let _ = std::fs::remove_file(&old);
    if target.exists() {
        std::fs::rename(target, &old).map_err(|e| format!("Could not replace {}: {e}", target.display()))?;
    }
    std::fs::rename(new, target).map_err(|e| format!("Could not install {}: {e}", target.display()))?;
    let _ = std::fs::remove_file(&old);
    Ok(())
}

/// Result of an install or update, in words for the user.
pub type InstallResult = Result<String, String>;

async fn install_ytdlp(force: bool) -> InstallResult {
    emit("yt-dlp", "checking", 0, 0, "Checking for the latest video engine…");
    let expected = parse_checksum(&fetch_text(YTDLP_SUMS_URL).await?, "yt-dlp.exe")
        .ok_or("The video engine update has no checksum, so it was not installed.")?;
    let tools = dir();
    std::fs::create_dir_all(&tools).map_err(|e| e.to_string())?;
    let target = tools.join("yt-dlp.exe");
    if !force && target.is_file() && sha256_file(&target).map(|h| h == expected).unwrap_or(false) {
        emit("yt-dlp", "done", 0, 0, "The video engine is up to date.");
        return Ok("The video engine is already up to date.".into());
    }
    let part = tools.join("yt-dlp.exe.part");
    let actual = download_to(YTDLP_URL, &part, "yt-dlp").await.inspect_err(|_| {
        let _ = std::fs::remove_file(&part);
    })?;
    emit("yt-dlp", "verifying", 0, 0, "Checking the download…");
    if actual != expected {
        let _ = std::fs::remove_file(&part);
        return Err("The downloaded video engine did not match its published checksum, so it was discarded.".into());
    }
    swap_in(&part, &target)?;
    emit("yt-dlp", "done", 0, 0, "Video engine installed.");
    Ok("The video engine is installed and up to date.".into())
}

/// Find `name` anywhere below `root`.
fn find_file(root: &Path, name: &str) -> Option<PathBuf> {
    for entry in std::fs::read_dir(root).ok()?.flatten() {
        let p = entry.path();
        if p.is_dir() {
            if let Some(found) = find_file(&p, name) {
                return Some(found);
            }
        } else if p.file_name().is_some_and(|n| n.eq_ignore_ascii_case(name)) {
            return Some(p);
        }
    }
    None
}

async fn install_ffmpeg(force: bool) -> InstallResult {
    let tools = dir();
    std::fs::create_dir_all(&tools).map_err(|e| e.to_string())?;
    if !force && tools.join("ffmpeg.exe").is_file() {
        return Ok("The media converter is already installed.".into());
    }
    emit("ffmpeg", "checking", 0, 0, "Checking for the media converter…");
    let expected = parse_checksum(&fetch_text(FFMPEG_SHA_URL).await?, "ffmpeg-release-essentials.zip")
        .ok_or("The media converter download has no checksum, so it was not installed.")?;
    let zip = tools.join("ffmpeg-download.zip");
    let actual = download_to(FFMPEG_URL, &zip, "ffmpeg").await.inspect_err(|_| {
        let _ = std::fs::remove_file(&zip);
    })?;
    emit("ffmpeg", "verifying", 0, 0, "Checking the download…");
    if actual != expected {
        let _ = std::fs::remove_file(&zip);
        return Err("The downloaded media converter did not match its published checksum, so it was discarded.".into());
    }
    emit("ffmpeg", "extracting", 0, 0, "Unpacking the media converter…");
    let extract = tools.join("ffmpeg-unpack");
    let _ = std::fs::remove_dir_all(&extract);
    std::fs::create_dir_all(&extract).map_err(|e| e.to_string())?;
    let (zip2, extract2) = (zip.clone(), extract.clone());
    let unpacked = tokio::task::spawn_blocking(move || {
        hide_window(&mut Command::new("tar.exe")).arg("-xf").arg(&zip2).arg("-C").arg(&extract2).status()
    })
    .await
    .map_err(|e| e.to_string())?;
    let result = (|| {
        if !unpacked.map(|s| s.success()).unwrap_or(false) {
            return Err("Windows could not unpack the media converter download.".to_string());
        }
        for exe in ["ffmpeg.exe", "ffprobe.exe"] {
            if let Some(src) = find_file(&extract, exe) {
                let staged = tools.join(format!("{exe}.part"));
                std::fs::copy(&src, &staged).map_err(|e| format!("Could not copy a media converter file: {e}"))?;
                swap_in(&staged, &tools.join(exe))?;
            } else if exe == "ffmpeg.exe" {
                return Err("The media converter download was incomplete.".to_string());
            }
        }
        Ok(())
    })();
    let _ = std::fs::remove_file(&zip);
    let _ = std::fs::remove_dir_all(&extract);
    result?;
    emit("ffmpeg", "done", 0, 0, "Media converter installed.");
    Ok("The media converter is installed.".into())
}

/// Install (or, with `force` / for yt-dlp, update) one tool: "yt-dlp" or "ffmpeg".
pub async fn install(tool: &str, force: bool) -> InstallResult {
    let _guard = INSTALL_LOCK.lock().await;
    let result = match tool {
        "yt-dlp" => install_ytdlp(force).await,
        "ffmpeg" => install_ffmpeg(force).await,
        _ => Err("Unknown component.".to_string()),
    };
    if let Err(e) = &result {
        emit(tool, "error", 0, 0, e);
    }
    result
}

/// What the user sees instead of a helper program's real name.
pub fn friendly_name(tool: &str) -> &'static str {
    match tool {
        "yt-dlp" => "The video engine",
        "ffmpeg" => "The media converter",
        _ => "A required component",
    }
}

/// Replace the names of the programs BoltGrab uses behind the scenes in text that is shown to the user
/// (their own error output can mention them).
pub fn scrub(text: &str) -> String {
    let mut out = text.to_string();
    for (name, shown) in [("yt-dlp", "the video engine"), ("ffprobe", "the media converter"), ("ffmpeg", "the media converter")] {
        let mut lower = out.to_ascii_lowercase();
        while let Some(i) = lower.find(name) {
            out.replace_range(i..i + name.len(), shown);
            lower = out.to_ascii_lowercase();
        }
    }
    out
}

/// Install `tool` if it is not available yet.
pub async fn ensure(tool: &str) -> Result<(), String> {
    if find(tool).is_none() {
        install(tool, false).await.map_err(|e| {
            format!("{} is needed for this download and could not be installed automatically. {e}", friendly_name(tool))
        })?;
    }
    Ok(())
}

/// Make sure video downloads can run: install whatever is missing (nothing is touched when both are present).
pub async fn ensure_video_tools() -> Result<(), String> {
    ensure("yt-dlp").await?;
    ensure("ffmpeg").await
}

/// Background refresh of the managed yt-dlp, at most once a week.
pub async fn auto_update(db: &crate::db::Db) {
    if db.get_setting("tools_auto_update").await.as_deref() == Some("0") {
        return;
    }
    let now = chrono::Utc::now().timestamp();
    let last = db.get_setting("tools_checked_at").await.and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
    if now - last < AUTO_UPDATE_AFTER_SECS || !dir().join("yt-dlp.exe").is_file() {
        return;
    }
    if install("yt-dlp", false).await.is_ok() {
        let _ = db.set_setting("tools_checked_at", &now.to_string()).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SUMS: &str = "e51e69e8  yt-dlp\n\
f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d  yt-dlp.exe\n\
0066dbac3c124028e2dcae2a197fccee33cd91f456313d24f7af89fd54590e98 *yt-dlp_arm64.exe\n";

    #[test]
    fn checksum_lines_are_matched_by_exact_file_name() {
        assert_eq!(
            parse_checksum(SUMS, "yt-dlp.exe").as_deref(),
            Some("f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d")
        );
        assert_eq!(
            parse_checksum(SUMS, "yt-dlp_arm64.exe").as_deref(),
            Some("0066dbac3c124028e2dcae2a197fccee33cd91f456313d24f7af89fd54590e98"),
            "a leading * (binary mode) is ignored"
        );
        assert_eq!(parse_checksum(SUMS, "yt-dlp_x86.exe"), None, "no match means no install");
    }

    #[test]
    fn a_one_line_hash_file_is_accepted_but_garbage_is_not() {
        let h = "B9BBBB3ACECE000CBEEC994F856649354E52C773807841E78908374B24D658FD";
        assert_eq!(parse_checksum(&format!("{h}\n"), "anything.zip").as_deref(), Some(&h.to_ascii_lowercase()[..]));
        assert_eq!(parse_checksum("<html>not found</html>", "x"), None);
        assert_eq!(parse_checksum("", "x"), None);
    }

    #[test]
    fn scrub_hides_helper_program_names() {
        let s = scrub("ERROR: yt-dlp failed; ffmpeg not found. Update with yt-dlp -U (FFmpeg, ffprobe)");
        let lower = s.to_ascii_lowercase();
        assert!(!lower.contains("yt-dlp") && !lower.contains("ffmpeg") && !lower.contains("ffprobe"), "{s}");
        assert!(s.contains("the video engine failed"), "{s}");
    }

    #[test]
    fn files_are_found_inside_nested_folders() {
        let d = tempfile::tempdir().unwrap();
        let bin = d.path().join("ffmpeg-7.1-essentials_build").join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join("FFmpeg.EXE"), b"x").unwrap();
        assert!(find_file(d.path(), "ffmpeg.exe").is_some());
        assert!(find_file(d.path(), "ffprobe.exe").is_none());
    }

    #[test]
    fn replacing_a_tool_keeps_working_when_the_old_copy_exists() {
        let d = tempfile::tempdir().unwrap();
        let target = d.path().join("yt-dlp.exe");
        std::fs::write(&target, b"old").unwrap();
        let fresh = d.path().join("yt-dlp.exe.part");
        std::fs::write(&fresh, b"new").unwrap();
        swap_in(&fresh, &target).unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"new");
        assert!(!fresh.exists() && !d.path().join("yt-dlp.exe.old").exists());
    }

    /// Real download of both tools (about 140 MB): `cargo test --lib live_install_tools -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn live_install_tools() {
        let tmp = tempfile::tempdir().unwrap();
        std::env::set_var("APPDATA", tmp.path());
        println!("{:?}", install("yt-dlp", false).await);
        println!("{:?}", install("yt-dlp", false).await); // second call: up to date, no download
        println!("{:?}", install("ffmpeg", false).await);
        for t in status() {
            println!("{t:?}");
        }
        assert!(find("yt-dlp").is_some_and(|(_, managed)| managed));
        assert!(find("ffmpeg").is_some_and(|(_, managed)| managed));
    }
}
