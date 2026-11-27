//! Tauri commands: a thin layer over the engine and download management features.
//! Errors are returned as plain-language strings.

use std::path::{Path, PathBuf};

use flowget_engine::{AdapterInfo, AddRequest, DownloadInfo, DownloadState, MAX_CONNECTIONS, MIN_CONNECTIONS};
use serde::Serialize;
use tauri::{Emitter, State};

use crate::categories;
use crate::db::{Category, QueueInfo};
use crate::post_download::PostDownloadManager;
use crate::AppState;

type CmdResult<T> = Result<T, String>;

fn msg(e: flowget_engine::EngineError) -> String {
    e.user_message()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub global_speed_limit: u64,
    pub default_connections: u32,
    pub min_connections: u32,
    pub max_connections: u32,
    pub download_dir: String,
    pub online: bool,
    pub turbo_mode: bool,
    pub proxy: Option<String>,
    pub start_with_windows: bool,
    pub file_types: String,
    pub language: String,
    pub theme: String,
    pub auto_extract: bool,
    pub virus_scan: bool,
    pub open_folder_on_complete: bool,
    pub battery_saver: bool,
    pub smart_naming: bool,
    /// Continue downloads that were running when the app last closed.
    pub resume_on_start: bool,
    pub clipboard_monitor: bool,
    pub background: String,
    /// Drive shown on the Disk Space card and preselected in Disk Cleaner, e.g. "D:\". Empty = the download folder's drive.
    pub default_drive: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateCheckResult {
    pub has_duplicate: bool,
    pub url_match: Option<DownloadInfo>,
    pub file_exists: bool,
    pub existing_file_path: Option<String>,
    pub suggested_file_name: String,
}

// ---- yt-dlp (video page) downloads: tracked here so they can be paused, resumed and cancelled ----

#[derive(Clone)]
struct YtParams {
    url: String,
    save_dir: String,
    name_stem: Option<String>,
    format_id: Option<String>,
    audio_only: bool,
    convert: Option<String>,
    height: Option<u32>,
    fps: Option<u32>,
}

struct YtJob {
    params: YtParams,
    temp_dir: PathBuf,
    info: std::sync::Mutex<DownloadInfo>,
    ctl: std::sync::Mutex<std::sync::Arc<crate::media_stream::YtControl>>,
}

static YT_JOBS: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, std::sync::Arc<YtJob>>>> =
    std::sync::OnceLock::new();

fn yt_jobs() -> &'static std::sync::Mutex<std::collections::HashMap<String, std::sync::Arc<YtJob>>> {
    YT_JOBS.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

fn yt_job(id: &str) -> Option<std::sync::Arc<YtJob>> {
    yt_jobs().lock().unwrap().get(id).cloned()
}

/// Stop every running yt-dlp download (used when the app exits so no process is left behind).
pub fn stop_all_yt_jobs() {
    let jobs: Vec<_> = yt_jobs().lock().unwrap().values().cloned().collect();
    for job in jobs {
        let ctl = job.ctl.lock().unwrap().clone();
        ctl.stop(crate::media_stream::YtControl::PAUSE);
    }
}

/// Start (or restart after a pause) the yt-dlp process for a job.
fn spawn_ytdlp(job: std::sync::Arc<YtJob>, app: tauri::AppHandle, db: crate::db::Db, engine: flowget_engine::Engine) {
    use crate::media_stream::{YtControl, YT_CANCELLED, YT_PAUSED};

    let ctl = std::sync::Arc::new(YtControl::default());
    *job.ctl.lock().unwrap() = ctl.clone();
    {
        let mut i = job.info.lock().unwrap();
        i.state = DownloadState::Downloading;
        i.error = None;
        i.note = Some("Preparing video...".to_string());
        let _ = app.emit("download-updated", &*i);
    }

    tokio::spawn(async move {
        let (job_b, app_b, ctl_b) = (job.clone(), app.clone(), ctl.clone());
        // yt-dlp and ffmpeg are installed automatically the first time a video download needs them.
        let tools_ready = crate::tools::ensure_video_tools().await;
        let res = if let Err(e) = tools_ready { Err(e) } else { tokio::task::spawn_blocking(move || {
            let p = &job_b.params;
            let mut last_emit = std::time::Instant::now();
            crate::media_stream::download_ytdlp_blocking(
                &p.url,
                Path::new(&p.save_dir),
                Some(&job_b.temp_dir),
                p.name_stem.as_deref(),
                p.format_id.as_deref(),
                p.audio_only,
                p.convert.as_deref(),
                p.height,
                p.fps,
                &ctl_b,
                |downloaded, total, speed, eta| {
                    if last_emit.elapsed() < std::time::Duration::from_millis(400) {
                        return;
                    }
                    last_emit = std::time::Instant::now();
                    let mut i = job_b.info.lock().unwrap();
                    i.downloaded = downloaded;
                    i.total_size = total;
                    i.speed_bps = speed;
                    i.eta_secs = eta;
                    i.note = Some("Downloading video...".to_string());
                    let _ = app_b.emit("download-updated", &*i);
                },
            )
        })
        .await
        .map_err(|e| format!("Task error: {e}"))
        .and_then(|r| r) };

        let id = job.info.lock().unwrap().id.clone();

        if let Err(e) = &res {
            if e == YT_PAUSED {
                // keep the job (and its partial files) so it can be resumed
                let mut i = job.info.lock().unwrap();
                i.state = DownloadState::Paused;
                i.speed_bps = 0;
                i.eta_secs = None;
                i.note = None;
                let _ = app.emit("download-updated", &*i);
                return;
            }
            if e == YT_CANCELLED {
                yt_jobs().lock().unwrap().remove(&id);
                let _ = std::fs::remove_dir_all(&job.temp_dir);
                let _ = app.emit("download-removed", id);
                return;
            }
        }

        let mut done = job.info.lock().unwrap().clone();
        match res {
            Ok(path) => {
                let size = std::fs::metadata(&path).ok().map(|m| m.len()).unwrap_or(0);
                done.file_name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or(done.file_name);
                done.file_path = path.to_string_lossy().to_string();
                done.state = DownloadState::Completed;
                done.downloaded = size;
                done.total_size = Some(size);
                done.speed_bps = 0;
                done.eta_secs = None;
                done.completed_at = Some(chrono::Utc::now().timestamp());
                done.note = None;
            }
            Err(e) => {
                done.state = DownloadState::Failed;
                done.speed_bps = 0;
                done.eta_secs = None;
                done.note = None;
                done.error = Some(flowget_engine::UserError { code: "VIDEO_ERROR".to_string(), message: e });
            }
        }

        yt_jobs().lock().unwrap().remove(&id);
        let _ = std::fs::remove_dir_all(&job.temp_dir);

        let rec = flowget_engine::DownloadRecord {
            id: done.id.clone(),
            url: done.url.clone(),
            final_url: None,
            save_dir: done.save_dir.clone(),
            file_name: done.file_name.clone(),
            file_name_locked: true,
            file_path: done.file_path.clone(),
            total_size: done.total_size,
            downloaded: done.downloaded,
            resume_supported: Some(false),
            mime: done.mime.clone(),
            etag: None,
            last_modified: None,
            segments: Vec::new(),
            connections: 1,
            speed_limit: 0,
            http: Default::default(),
            checksum: None,
            checksum_verified: None,
            mirrors: Vec::new(),
            mirror_report: Vec::new(),
            state: done.state,
            error: done.error.clone(),
            created_at: done.created_at,
            completed_at: done.completed_at,
            category: done.category.clone(),
            queue_id: done.queue_id.clone(),
            queue_order: done.queue_order,
            interrupted: false,
        };
        let _ = db.upsert_download(&rec).await;
        // registered with the engine so it stays in the list, can be removed and reloads on restart
        engine.restore(vec![rec]);
        let _ = app.emit("download-updated", &done);
    });
}

/// Cancel a yt-dlp job: end its process, drop it from the list and delete its partial files.
fn cancel_yt_job(job: &std::sync::Arc<YtJob>, app: &tauri::AppHandle) {
    let id = job.info.lock().unwrap().id.clone();
    yt_jobs().lock().unwrap().remove(&id);
    let ctl = job.ctl.lock().unwrap().clone();
    ctl.stop(crate::media_stream::YtControl::CANCEL);
    let _ = std::fs::remove_dir_all(&job.temp_dir);
    let _ = app.emit("download-removed", id);
}

/// Add a download and start or queue it.
#[tauri::command]
pub async fn add_download(state: State<'_, AppState>, mut request: AddRequest) -> CmdResult<DownloadInfo> {
    // 1. Check if Torrent or Magnet link
    if crate::torrent::TorrentManager::is_torrent(&request.url) {
        let id = uuid::Uuid::new_v4().to_string();
        let save_dir = request.save_dir.clone().unwrap_or_else(|| {
            state.engine.default_dir().join("Torrents").to_string_lossy().to_string()
        });
        let file_name = request.file_name.clone().unwrap_or_else(|| {
            if request.url.starts_with("magnet:") {
                request
                    .url
                    .split("dn=")
                    .nth(1)
                    .and_then(|s| s.split('&').next())
                    .unwrap_or("Torrent Download")
                    .to_string()
            } else {
                "Torrent Download".to_string()
            }
        });
        let file_path = format!("{save_dir}\\{file_name}");
        let now = chrono::Utc::now().timestamp();

        let info = DownloadInfo {
            id: id.clone(),
            url: request.url.clone(),
            file_name: file_name.clone(),
            file_path: file_path.clone(),
            save_dir: save_dir.clone(),
            total_size: None,
            downloaded: 0,
            state: DownloadState::Downloading,
            resume_supported: Some(true),
            mime: Some("application/x-bittorrent".to_string()),
            connections: 1,
            speed_limit: 0,
            checksum: None,
            checksum_verified: None,
            error: None,
            created_at: now,
            completed_at: None,
            speed_bps: 0,
            eta_secs: None,
            segments: Vec::new(),
            note: Some("Connecting to peers...".to_string()),
            protocol: Some("BitTorrent".to_string()),
            mirrors: Vec::new(),
            category: Some("Torrents".to_string()),
            queue_id: request.queue_id.clone(),
            queue_order: request.queue_order,
        };

        let tm = state.torrent_mgr.clone();
        let u = request.url.clone();
        let sp = PathBuf::from(&save_dir);
        let app_handle = state.app_handle.clone();
        let id_clone = id.clone();
        let info_clone = info.clone();
        let db_clone = state.db.clone();

        tokio::spawn(async move {
            let _ = tm.add(&u, Some(&sp)).await;
            let rec = flowget_engine::DownloadRecord {
                id: id_clone,
                url: u,
                final_url: None,
                save_dir,
                file_name,
                file_name_locked: true,
                file_path,
                total_size: None,
                downloaded: 0,
                resume_supported: Some(true),
                mime: Some("application/x-bittorrent".to_string()),
                etag: None,
                last_modified: None,
                segments: Vec::new(),
                connections: 1,
                speed_limit: 0,
                http: Default::default(),
                checksum: None,
                checksum_verified: None,
                mirrors: Vec::new(),
                mirror_report: Vec::new(),
                state: DownloadState::Downloading,
                error: None,
                created_at: now,
                completed_at: None,
                category: Some("Torrents".to_string()),
                queue_id: None,
                queue_order: None,
                interrupted: false,
            };
            let _ = db_clone.upsert_download(&rec).await;
            let _ = app_handle.emit("download-updated", &info_clone);
        });

        return Ok(info);
    }

    // 2. Check if FTP, FTPS, or SFTP
    if crate::protocols::is_ftp_or_sftp(&request.url) {
        let id = uuid::Uuid::new_v4().to_string();
        let save_dir = request.save_dir.clone().unwrap_or_else(|| {
            state.engine.default_dir().to_string_lossy().to_string()
        });
        let file_name = request.file_name.clone().unwrap_or_else(|| {
            request.url.split('/').last().unwrap_or("download").split('?').next().unwrap_or("download").to_string()
        });
        let file_path = format!("{save_dir}\\{file_name}");
        let now = chrono::Utc::now().timestamp();
        let is_sftp = request.url.to_lowercase().starts_with("sftp://");
        let proto_name = if is_sftp { "SFTP" } else { "FTP" };

        let info = DownloadInfo {
            id: id.clone(),
            url: request.url.clone(),
            file_name: file_name.clone(),
            file_path: file_path.clone(),
            save_dir: save_dir.clone(),
            total_size: None,
            downloaded: 0,
            state: DownloadState::Downloading,
            resume_supported: Some(true),
            mime: None,
            connections: 1,
            speed_limit: 0,
            checksum: None,
            checksum_verified: None,
            error: None,
            created_at: now,
            completed_at: None,
            speed_bps: 0,
            eta_secs: None,
            segments: Vec::new(),
            note: Some(format!("Downloading via {proto_name}...")),
            protocol: Some(proto_name.to_string()),
            mirrors: Vec::new(),
            category: request.category.clone(),
            queue_id: request.queue_id.clone(),
            queue_order: request.queue_order,
        };

        let u = request.url.clone();
        let out_p = PathBuf::from(&file_path);
        let app_handle = state.app_handle.clone();
        let mut info_clone = info.clone();

        tokio::spawn(async move {
            let res = if is_sftp {
                crate::protocols::download_sftp(&u, &out_p, None, None).await
            } else {
                crate::protocols::download_ftp(&u, &out_p, None, None).await
            };

            let file_size = std::fs::metadata(&out_p).ok().map(|m| m.len()).unwrap_or(0);
            match res {
                Ok(_) => {
                    info_clone.state = DownloadState::Completed;
                    info_clone.downloaded = file_size;
                    info_clone.total_size = Some(file_size);
                    info_clone.completed_at = Some(chrono::Utc::now().timestamp());
                    info_clone.note = None;
                }
                Err(e) => {
                    info_clone.state = DownloadState::Failed;
                    info_clone.error = Some(flowget_engine::UserError {
                        code: "PROTOCOL_ERROR".to_string(),
                        message: e,
                    });
                }
            }
            let _ = app_handle.emit("download-updated", &info_clone);
        });

        return Ok(info);
    }

    // 2b. Video pages (YouTube, Vimeo, ...): resolve and download with yt-dlp. A streaming playlist whose quality
    // was chosen in the browser menu goes the same way: yt-dlp picks the right variant of the playlist.
    let manifest_with_quality = crate::media_stream::is_manifest_url(&request.url)
        && (request.media_height.is_some() || request.media_audio_only == Some(true));
    if crate::media_stream::is_video_page_url(&request.url) || manifest_with_quality {
        crate::media_stream::validate_remote_url(&request.url)?;
        let lic_status = crate::licensing::get_status(&state.db).await;
        if !lic_status.media_download_allowed {
            return Err("Video downloading requires a BoltGrab Pro license.".to_string());
        }

        let id = uuid::Uuid::new_v4().to_string();
        let convert = request.convert_to.clone().filter(|c| matches!(c.as_str(), "mp3" | "m4a" | "mp4" | "mkv"));
        let is_audio = matches!(convert.as_deref(), Some("mp3") | Some("m4a")) || request.media_audio_only == Some(true);
        let default_sub = if is_audio { "Music" } else { "Videos" };
        let save_dir = request.save_dir.clone().unwrap_or_else(|| {
            state.engine.default_dir().join(default_sub).to_string_lossy().to_string()
        });
        // Only trust a typed/auto-filled name when a quality was resolved; otherwise yt-dlp names it by title.
        let name_stem = if request.media_format.is_some() || manifest_with_quality { request.file_name.clone() } else { None };
        let shown_name = name_stem.clone().unwrap_or_else(|| "Video (fetching title...)".to_string());
        let now = chrono::Utc::now().timestamp();

        let info = DownloadInfo {
            id: id.clone(),
            url: request.url.clone(),
            file_name: shown_name.clone(),
            file_path: format!("{save_dir}\\{shown_name}"),
            save_dir: save_dir.clone(),
            total_size: None,
            downloaded: 0,
            state: DownloadState::Downloading,
            resume_supported: Some(true),
            mime: Some(if is_audio { "audio/mpeg" } else { "video/mp4" }.to_string()),
            connections: 1,
            speed_limit: 0,
            checksum: None,
            checksum_verified: None,
            error: None,
            created_at: now,
            completed_at: None,
            speed_bps: 0,
            eta_secs: None,
            segments: Vec::new(),
            note: Some("Preparing video...".to_string()),
            protocol: Some("Video".to_string()),
            mirrors: Vec::new(),
            category: Some(default_sub.to_string()),
            queue_id: request.queue_id.clone(),
            queue_order: request.queue_order,
        };

        let job = std::sync::Arc::new(YtJob {
            params: YtParams {
                url: request.url.clone(),
                save_dir: save_dir.clone(),
                name_stem,
                format_id: request.media_format.clone(),
                audio_only: request.media_audio_only == Some(true),
                convert,
                height: request.media_height,
                fps: request.media_fps,
            },
            temp_dir: PathBuf::from(&save_dir).join(format!(".flowget-{id}")),
            info: std::sync::Mutex::new(info.clone()),
            ctl: std::sync::Mutex::new(std::sync::Arc::new(crate::media_stream::YtControl::default())),
        });
        yt_jobs().lock().unwrap().insert(id, job.clone());
        spawn_ytdlp(job, state.app_handle.clone(), state.db.clone(), state.engine.clone());

        return Ok(info);
    }

    // 3. Check if HLS (.m3u8) or DASH (.mpd)
    if request.url.contains(".m3u8") || request.url.contains(".mpd") {
        let is_dash = request.url.contains(".mpd");
        let id = uuid::Uuid::new_v4().to_string();
        let save_dir = request.save_dir.clone().unwrap_or_else(|| {
            state.engine.default_dir().join("Videos").to_string_lossy().to_string()
        });
        let mut file_name = request.file_name.clone().unwrap_or_else(|| {
            "stream.mp4".to_string()
        });
        if !file_name.ends_with(".mp4") && !file_name.ends_with(".mkv") && !file_name.ends_with(".mp3") {
            file_name = format!("{file_name}.mp4");
        }
        let file_path = format!("{save_dir}\\{file_name}");
        let now = chrono::Utc::now().timestamp();
        let proto_name = if is_dash { "DASH" } else { "HLS" };

        let info = DownloadInfo {
            id: id.clone(),
            url: request.url.clone(),
            file_name: file_name.clone(),
            file_path: file_path.clone(),
            save_dir: save_dir.clone(),
            total_size: None,
            downloaded: 0,
            state: DownloadState::Downloading,
            resume_supported: Some(true),
            mime: Some("video/mp4".to_string()),
            connections: 8,
            speed_limit: 0,
            checksum: None,
            checksum_verified: None,
            error: None,
            created_at: now,
            completed_at: None,
            speed_bps: 0,
            eta_secs: None,
            segments: Vec::new(),
            note: Some(format!("Downloading & merging {proto_name} segments...")),
            protocol: Some(proto_name.to_string()),
            mirrors: Vec::new(),
            category: Some("Videos".to_string()),
            queue_id: request.queue_id.clone(),
            queue_order: request.queue_order,
        };

        let u = request.url.clone();
        let out_p = PathBuf::from(&file_path);
        let app_handle = state.app_handle.clone();
        let mut info_clone = info.clone();

        tokio::spawn(async move {
            let res = if is_dash {
                crate::media_stream::download_dash(&u, &out_p, None).await
            } else {
                crate::media_stream::download_hls(&u, &out_p, None).await
            };

            let file_size = std::fs::metadata(&out_p).ok().map(|m| m.len()).unwrap_or(0);
            match res {
                Ok(_) => {
                    info_clone.state = DownloadState::Completed;
                    info_clone.downloaded = file_size;
                    info_clone.total_size = Some(file_size);
                    info_clone.completed_at = Some(chrono::Utc::now().timestamp());
                    info_clone.note = None;
                }
                Err(e) => {
                    info_clone.state = DownloadState::Failed;
                    info_clone.error = Some(flowget_engine::UserError {
                        code: "STREAM_ERROR".to_string(),
                        message: e,
                    });
                }
            }
            let _ = app_handle.emit("download-updated", &info_clone);
        });

        return Ok(info);
    }

    // 4. Standard HTTP/HTTPS via Engine
    // If category not specified, auto-detect
    if request.category.is_none() {
        if let Ok(cats) = state.db.load_categories().await {
            let cat_id = categories::categorize_file(&request.url, &cats);
            request.category = Some(cat_id.clone());

            // If saveDir not set, use category default folder
            if request.save_dir.is_none() {
                if let Some(cat) = cats.iter().find(|c| c.id == cat_id) {
                    if !cat.default_folder.is_empty() {
                        request.save_dir = Some(cat.default_folder.clone());
                    }
                }
            }
        }
    }

    // Attach global proxy if request doesn't have one and global proxy is configured
    if request.http.proxy.is_none() {
        if let Some(p) = state.db.get_setting("proxy").await {
            let pt = p.trim().to_string();
            if !pt.is_empty() {
                request.http.proxy = Some(pt);
            }
        }
    }

    state.engine.add(request).await.map_err(msg)
}

#[tauri::command]
pub async fn pause(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    if let Some(job) = yt_job(&id) {
        let ctl = job.ctl.lock().unwrap().clone();
        ctl.stop(crate::media_stream::YtControl::PAUSE);
        return Ok(());
    }
    state.engine.pause(&id).await.map_err(msg)
}

#[tauri::command]
pub async fn resume(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    if let Some(job) = yt_job(&id) {
        let paused = job.info.lock().unwrap().state == DownloadState::Paused;
        if paused {
            spawn_ytdlp(job, state.app_handle.clone(), state.db.clone(), state.engine.clone());
        }
        return Ok(());
    }
    state.engine.resume(&id).await.map_err(msg)
}

#[tauri::command]
pub async fn mark_queued(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.engine.mark_queued(&id).await.map_err(msg)
}

#[tauri::command]
pub async fn cancel(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    if let Some(job) = yt_job(&id) {
        cancel_yt_job(&job, &state.app_handle);
        return Ok(());
    }
    state.engine.cancel(&id).await.map_err(msg)
}

#[tauri::command]
pub async fn refresh_link(state: State<'_, AppState>, id: String, new_url: String) -> CmdResult<()> {
    state.engine.refresh_link(&id, &new_url).await.map_err(msg)
}

#[tauri::command]
pub async fn restart(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.engine.restart(&id).await.map_err(msg)
}

#[tauri::command]
pub async fn remove(state: State<'_, AppState>, id: String, delete_file: bool) -> CmdResult<()> {
    if let Some(job) = yt_job(&id) {
        cancel_yt_job(&job, &state.app_handle);
        return Ok(());
    }
    state.engine.remove(&id, delete_file).await.map_err(msg)
}

#[tauri::command]
pub fn get_downloads(state: State<'_, AppState>) -> Vec<DownloadInfo> {
    let mut list = state.engine.list();
    // yt-dlp downloads that are still running or paused live outside the engine
    for job in yt_jobs().lock().unwrap().values() {
        list.push(job.info.lock().unwrap().clone());
    }
    list.sort_by(|a, b| a.created_at.cmp(&b.created_at).then_with(|| a.id.cmp(&b.id)));
    list
}

#[tauri::command]
pub async fn set_download_meta(
    state: State<'_, AppState>,
    id: String,
    category: Option<String>,
    queue_id: Option<String>,
    queue_order: Option<i32>,
) -> CmdResult<DownloadInfo> {
    state.engine.set_download_meta(&id, category, queue_id, queue_order).map_err(msg)
}

#[tauri::command]
pub async fn set_speed_limit(state: State<'_, AppState>, id: Option<String>, bytes_per_sec: u64) -> CmdResult<()> {
    match id {
        Some(id) => state.engine.set_download_speed_limit(&id, bytes_per_sec).map_err(msg),
        None => {
            state.engine.set_global_speed_limit(bytes_per_sec);
            let saved = state
                .db
                .set_setting("global_speed_limit", &bytes_per_sec.to_string())
                .await
                .map_err(|e| format!("Could not save setting: {e}"));
            // Schedules and slow mode build on this value: let them look again.
            state.bandwidth.refresh();
            saved
        }
    }
}

// ------------------- Duplicate Detection -------------------

#[tauri::command]
pub async fn check_duplicate(
    state: State<'_, AppState>,
    url: String,
    save_dir: Option<String>,
    file_name: Option<String>,
) -> CmdResult<DuplicateCheckResult> {
    let list = state.engine.list();
    let url_trimmed = url.trim();

    // 1. Check URL match
    let url_match = list.iter().find(|d| d.url.trim().eq_ignore_ascii_case(url_trimmed)).cloned();

    // 2. Check File match
    let effective_dir = match save_dir {
        Some(d) if !d.trim().is_empty() => PathBuf::from(d),
        _ => state.engine.default_dir().to_path_buf(),
    };

    let target_name = match file_name {
        Some(n) if !n.trim().is_empty() => n.trim().to_string(),
        _ => {
            // Deduce from URL
            url::Url::parse(url_trimmed)
                .ok()
                .and_then(|u| {
                    u.path_segments()
                        .and_then(|mut s| s.next_back())
                        .map(|s| s.to_string())
                })
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "download".to_string())
        }
    };

    let target_path = effective_dir.join(&target_name);
    let file_exists = target_path.exists();

    // Generate unique suggestion if exists
    let suggested_file_name = if file_exists {
        generate_unique_filename(&effective_dir, &target_name)
    } else {
        target_name
    };

    let has_duplicate = url_match.is_some() || file_exists;

    Ok(DuplicateCheckResult {
        has_duplicate,
        url_match,
        file_exists,
        existing_file_path: if file_exists { Some(target_path.to_string_lossy().to_string()) } else { None },
        suggested_file_name,
    })
}

fn generate_unique_filename(dir: &Path, original_name: &str) -> String {
    let p = Path::new(original_name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("");

    for i in 1..1000 {
        let candidate = if ext.is_empty() {
            format!("{stem} ({i})")
        } else {
            format!("{stem} ({i}).{ext}")
        };
        if !dir.join(&candidate).exists() {
            return candidate;
        }
    }
    format!("{stem}_{}", uuid::Uuid::new_v4())
}

// ------------------- Categories -------------------

#[tauri::command]
pub async fn get_categories(state: State<'_, AppState>) -> CmdResult<Vec<Category>> {
    state.db.load_categories().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_category(state: State<'_, AppState>, category: Category) -> CmdResult<()> {
    state.db.save_category(&category).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_category(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.db.delete_category(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn auto_categorize(state: State<'_, AppState>, name_or_url: String) -> CmdResult<String> {
    let cats = state.db.load_categories().await.map_err(|e| e.to_string())?;
    Ok(categories::categorize_file(&name_or_url, &cats))
}

// ------------------- Queues -------------------

#[tauri::command]
pub async fn get_queues(state: State<'_, AppState>) -> CmdResult<Vec<QueueInfo>> {
    state.db.load_queues().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_queue(state: State<'_, AppState>, queue: QueueInfo) -> CmdResult<()> {
    state.db.save_queue(&queue).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_queue(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.db.delete_queue(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_queue_running(state: State<'_, AppState>, id: String, running: bool) -> CmdResult<()> {
    state.db.set_queue_running(&id, running).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reorder_queue(
    state: State<'_, AppState>,
    _queue_id: String,
    download_ids: Vec<String>,
) -> CmdResult<()> {
    for (idx, id) in download_ids.iter().enumerate() {
        let _ = state.engine.set_download_meta(id, None, None, Some(idx as i32));
    }
    Ok(())
}

#[tauri::command]
pub async fn move_to_queue(state: State<'_, AppState>, id: String, queue_id: String) -> CmdResult<()> {
    state.engine.set_download_meta(&id, None, Some(queue_id), None).map_err(msg)?;
    Ok(())
}

// ------------------- Post Download & System -------------------

#[tauri::command]
pub async fn extract_archive(path: String, target_dir: Option<String>) -> CmdResult<String> {
    PostDownloadManager::extract_archive(&path, target_dir.as_deref()).await
}

#[tauri::command]
pub async fn scan_file_defender(path: String) -> CmdResult<String> {
    PostDownloadManager::scan_file(&path).await
}

#[tauri::command]
pub fn open_folder(path: String) -> CmdResult<()> {
    PostDownloadManager::reveal_in_explorer(&path)
}

/// Open a web address in the user's default browser (http and https only).
#[tauri::command]
pub fn open_url(url: String) -> CmdResult<()> {
    let parsed = url::Url::parse(url.trim()).map_err(|_| "That is not a valid web address.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only http and https addresses can be opened.".into());
    }
    // explorer.exe hands the address to the default browser; the argument is not interpreted by a shell.
    std::process::Command::new("explorer.exe")
        .arg(parsed.as_str())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not open your browser: {e}"))
}

#[tauri::command]
pub fn open_file(path: String) -> CmdResult<()> {
    PostDownloadManager::open_file(&path)
}

#[tauri::command]
pub async fn pick_folder(window: tauri::WebviewWindow, initial_dir: Option<String>) -> CmdResult<Option<String>> {
    // Native Windows "pick folder" dialog (modern, resizable, remembers its size), owned by the app window.
    tokio::task::spawn_blocking(move || {
        let mut dialog = rfd::FileDialog::new()
            .set_title("Select download destination folder")
            .set_parent(&window);
        if let Some(dir) = initial_dir.filter(|d| !d.is_empty() && std::path::Path::new(d).is_dir()) {
            dialog = dialog.set_directory(dir);
        }
        Ok(dialog.pick_folder().map(|p| p.to_string_lossy().to_string()))
    })
    .await
    .map_err(|e| format!("Task error: {e}"))?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskSpace {
    pub drive: String,
    pub total_bytes: u64,
    pub free_bytes: u64,
}

/// Run a PowerShell script and return its output, without opening a console window.
fn run_powershell(script: &str) -> Result<String, String> {
    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", script]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd.output().map_err(|e| format!("Could not run PowerShell: {e}"))?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Real total/free space of the drive that holds `path` (falls back to the system drive).
#[tauri::command]
pub async fn get_disk_space(path: String) -> CmdResult<DiskSpace> {
    tokio::task::spawn_blocking(move || disk_space_blocking(&path))
        .await
        .map_err(|e| format!("Task error: {e}"))?
}

/// Blocking form of [`get_disk_space`], also used by the browser extension's storage card.
pub fn disk_space_blocking(path: &str) -> CmdResult<DiskSpace> {
    {
        let script = format!(
            r#"$p = '{p}'; if ($p -eq '' -or -not (Test-Path $p)) {{ $p = $env:SystemDrive + '\' }}; $d = New-Object System.IO.DriveInfo ([System.IO.Path]::GetPathRoot((Resolve-Path $p).Path)); Write-Output ($d.Name + '|' + $d.TotalSize + '|' + $d.AvailableFreeSpace)"#,
            p = path.replace('\'', "''")
        );
        let text = run_powershell(&script)?;
        let mut parts = text.split('|');
        let drive = parts.next().unwrap_or("").to_string();
        let total = parts.next().and_then(|v| v.trim().parse::<u64>().ok());
        let free = parts.next().and_then(|v| v.trim().parse::<u64>().ok());
        match (total, free) {
            (Some(total_bytes), Some(free_bytes)) if total_bytes > 0 => Ok(DiskSpace { drive, total_bytes, free_bytes }),
            _ => Err("Disk space is not available".to_string()),
        }
    }
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DriveEntry {
    /// e.g. "C:\"
    pub name: String,
    pub label: String,
    /// "Fixed", "Removable" or "Network"
    pub kind: String,
    pub total_bytes: u64,
    pub free_bytes: u64,
}

/// Every ready local, removable and network drive on this PC.
pub fn read_drives() -> Result<Vec<DriveEntry>, String> {
    let script = r#"[System.IO.DriveInfo]::GetDrives() | Where-Object { $_.IsReady -and ($_.DriveType -eq 'Fixed' -or $_.DriveType -eq 'Removable' -or $_.DriveType -eq 'Network') } | ForEach-Object { $_.Name + '|' + $_.VolumeLabel + '|' + $_.DriveType + '|' + $_.TotalSize + '|' + $_.AvailableFreeSpace }"#;
    let text = run_powershell(script)?;
    let drives: Vec<DriveEntry> = text
        .lines()
        .filter_map(|line| {
            let f: Vec<&str> = line.trim().split('|').collect();
            if f.len() < 5 {
                return None;
            }
            Some(DriveEntry {
                name: f[0].to_string(),
                label: f[1].to_string(),
                kind: f[2].to_string(),
                total_bytes: f[3].trim().parse().ok()?,
                free_bytes: f[4].trim().parse().ok()?,
            })
        })
        .filter(|d| d.total_bytes > 0)
        .collect();
    if drives.is_empty() {
        Err("No drives were found".to_string())
    } else {
        Ok(drives)
    }
}

#[tauri::command]
pub async fn list_drives() -> CmdResult<Vec<DriveEntry>> {
    tokio::task::spawn_blocking(read_drives)
        .await
        .map_err(|e| format!("Task error: {e}"))?
}

#[tauri::command]
pub async fn update_download_path(
    _state: State<'_, AppState>,
    id: String,
    new_path: String,
) -> CmdResult<()> {
    println!("[commands] Updating target path for download {}: {}", id, new_path);
    Ok(())
}

#[tauri::command]
pub fn get_start_with_windows() -> bool {
    #[cfg(target_os = "windows")]
    {
        let out = crate::tools::hide_window(&mut std::process::Command::new("reg.exe"))
            .args(["query", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run", "/v", "BoltGrab"])
            .output();
        if let Ok(o) = out {
            return o.status.success();
        }
    }
    false
}

#[tauri::command]
pub fn set_start_with_windows(enabled: bool) -> CmdResult<bool> {
    #[cfg(target_os = "windows")]
    {
        if enabled {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let exe_str = format!("\"{}\"", exe.to_string_lossy());
            let status = crate::tools::hide_window(&mut std::process::Command::new("reg.exe"))
                .args([
                    "add",
                    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                    "/v",
                    "BoltGrab",
                    "/t",
                    "REG_SZ",
                    "/d",
                    &exe_str,
                    "/f",
                ])
                .status()
                .map_err(|e| format!("Registry add failed: {e}"))?;
            if !status.success() {
                return Err("Failed to register start with Windows in registry.".into());
            }
            Ok(true)
        } else {
            let _status = crate::tools::hide_window(&mut std::process::Command::new("reg.exe"))
                .args([
                    "delete",
                    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                    "/v",
                    "BoltGrab",
                    "/f",
                ])
                .status()
                .map_err(|e| format!("Registry delete failed: {e}"))?;
            // Status code 0 or 1 (already deleted) is fine
            Ok(false)
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

// ------------------- Settings -------------------

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> CmdResult<Settings> {
    let proxy = state.db.get_setting("proxy").await;
    let file_types = state.db.get_setting("file_types").await.unwrap_or_else(|| {
        "3GP 7Z AAC ACE AIF ARJ ASF AVI BIN BZ2 EXE GZ GZIP IMG ISO LZH M4A M4V MKV MOV MP3 MP4 MPA MPE MPEG MPG MSI MSU OGG OGV PDF PLJ PPS PPT PPTX QT R0* R1* RA RAR RM RGA SEA SIT SITX TAR TIF TIFF TXT WAV WMA WMV Z ZIP APK".to_string()
    });
    let language = state.db.get_setting("language").await.unwrap_or_else(|| "en".to_string());
    let theme = state.db.get_setting("theme").await.unwrap_or_else(|| "dark".to_string());
    let auto_extract = state.db.get_setting("auto_extract").await.as_deref() == Some("1");
    let virus_scan = state.db.get_setting("virus_scan").await.as_deref() == Some("1");
    let open_folder = state.db.get_setting("open_folder_on_complete").await.as_deref() == Some("1");
    let battery_saver = state.db.get_setting("battery_saver").await.as_deref() != Some("0"); // default true
    let smart_naming = state.db.get_setting("smart_naming").await.as_deref() != Some("0"); // default true
    let resume_on_start = state.db.get_setting("resume_on_start").await.as_deref() != Some("0"); // default true
    let clipboard_monitor = state.db.get_setting("clipboard_monitor").await.as_deref() != Some("0"); // default true
    let background = state.db.get_setting("background").await.unwrap_or_else(|| "flow".to_string());
    let default_drive = state.db.get_setting("default_drive").await.unwrap_or_default();

    Ok(Settings {
        // The user's own limit; the engine's current limit may be lower because of a schedule or slow mode.
        global_speed_limit: state.db.get_setting("global_speed_limit").await.and_then(|s| s.parse().ok()).unwrap_or(0),
        default_connections: state.engine.default_connections(),
        min_connections: MIN_CONNECTIONS,
        max_connections: MAX_CONNECTIONS,
        download_dir: state.engine.default_dir().to_string_lossy().to_string(),
        online: state.engine.is_online(),
        turbo_mode: state.engine.turbo_mode(),
        proxy,
        start_with_windows: get_start_with_windows(),
        file_types,
        language,
        theme,
        auto_extract,
        virus_scan,
        open_folder_on_complete: open_folder,
        battery_saver,
        smart_naming,
        resume_on_start,
        clipboard_monitor,
        background,
        default_drive,
    })
}

#[tauri::command]
pub async fn set_setting(state: State<'_, AppState>, key: String, value: String) -> CmdResult<()> {
    if crate::licensing::is_protected_setting(&key) {
        return Err("This setting can't be changed here.".to_string());
    }
    state.db.set_setting(&key, &value).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_setting(state: State<'_, AppState>, key: String) -> CmdResult<Option<String>> {
    Ok(state.db.get_setting(&key).await)
}

#[tauri::command]
pub async fn set_default_connections(state: State<'_, AppState>, connections: u32) -> CmdResult<u32> {
    let lic_status = crate::licensing::get_status(&state.db).await;
    let allowed_conns = connections.min(lic_status.max_connections);
    state.engine.set_default_connections(allowed_conns);
    let applied = state.engine.default_connections();
    state
        .db
        .set_setting("default_connections", &applied.to_string())
        .await
        .map_err(|e| format!("Could not save the setting: {e}"))?;
    Ok(applied)
}

#[tauri::command]
pub fn get_adapters(state: State<'_, AppState>) -> Vec<AdapterInfo> {
    state.engine.adapters()
}

#[tauri::command]
pub async fn set_turbo_mode(state: State<'_, AppState>, enabled: bool) -> CmdResult<bool> {
    let lic_status = crate::licensing::get_status(&state.db).await;
    if enabled && !lic_status.turbo_mode_allowed {
        return Err("Turbo Mode requires a BoltGrab Lifetime license.".to_string());
    }
    state.engine.set_turbo_mode(enabled);
    state
        .db
        .set_setting("turbo_mode", if enabled { "1" } else { "0" })
        .await
        .map_err(|e| format!("Could not save the setting: {e}"))?;
    Ok(enabled)
}

#[tauri::command]
pub fn expand_batch_patterns(input: String) -> crate::batch::BatchExpandResult {
    crate::batch::expand_batch(&input)
}

#[tauri::command]
pub async fn crawl_website(req: crate::site_grabber::GrabSiteRequest) -> CmdResult<Vec<crate::site_grabber::GrabbedAsset>> {
    crate::site_grabber::crawl_site(req).await
}

#[tauri::command]
pub async fn resolve_video_media(url: String) -> CmdResult<crate::media_stream::MediaResolveResult> {
    crate::media_stream::resolve_media(&url).await
}

#[tauri::command]
pub async fn download_stream_media(
    state: State<'_, AppState>,
    url: String,
    save_dir: String,
    file_name: String,
    _format_id: Option<String>,
    convert_to: Option<String>,
) -> CmdResult<String> {
    let lic_status = crate::licensing::get_status(&state.db).await;
    if !lic_status.media_download_allowed {
        return Err("Media stream downloading requires a BoltGrab Pro license.".to_string());
    }

    crate::tools::ensure("ffmpeg").await?;
    let out_dir = PathBuf::from(&save_dir);
    let _ = std::fs::create_dir_all(&out_dir);
    let out_file = out_dir.join(&file_name);

    if url.contains(".mpd") {
        crate::media_stream::download_dash(&url, &out_file, convert_to.as_deref()).await?;
    } else {
        crate::media_stream::download_hls(&url, &out_file, convert_to.as_deref()).await?;
    }

    Ok(out_file.to_string_lossy().to_string())
}

/// Downloads the browser extension sent before the window was ready (see `ipc_server::take_pending_captures`).
#[tauri::command]
pub fn take_pending_captures() -> Vec<crate::ipc_server::BrowserDownloadPayload> {
    crate::ipc_server::take_pending_captures()
}

#[tauri::command]
pub async fn update_ytdlp() -> CmdResult<String> {
    crate::tools::install("yt-dlp", false).await
}

#[tauri::command]
pub async fn get_bandwidth_policy(state: State<'_, AppState>) -> CmdResult<crate::bandwidth::Policy> {
    Ok(crate::bandwidth::load_policy(&state.db).await)
}

#[tauri::command]
pub async fn set_bandwidth_policy(state: State<'_, AppState>, policy: crate::bandwidth::Policy) -> CmdResult<()> {
    crate::bandwidth::save_policy(&state.db, &policy).await?;
    state.bandwidth.refresh();
    Ok(())
}

/// Switch slow mode on or off (the footer button).
#[tauri::command]
pub async fn set_slow_mode(state: State<'_, AppState>, on: bool) -> CmdResult<()> {
    let mut policy = crate::bandwidth::load_policy(&state.db).await;
    policy.slow_mode = on;
    crate::bandwidth::save_policy(&state.db, &policy).await?;
    state.bandwidth.refresh();
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BandwidthStatus {
    pub effective: crate::bandwidth::Effective,
    pub network: crate::metered::Network,
}

#[tauri::command]
pub fn get_bandwidth_state(state: State<'_, AppState>) -> BandwidthStatus {
    BandwidthStatus { effective: state.bandwidth.state(), network: state.bandwidth.network() }
}

/// "Download anyway" on a metered connection (until the app restarts).
#[tauri::command]
pub fn set_metered_override(state: State<'_, AppState>, on: bool) {
    state.bandwidth.set_override(on);
}

#[tauri::command]
pub async fn get_safety_reports(state: State<'_, AppState>) -> CmdResult<Vec<crate::safety::SafetyReport>> {
    state.db.load_safety().await.map_err(|e| e.to_string())
}

/// Warnings for a file name (used by the Add Download dialog before anything is downloaded).
#[tauri::command]
pub fn assess_file_name(file_name: String) -> Vec<crate::safety::Warning> {
    crate::safety::assess_name(&file_name)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VirusTotalStatus {
    pub has_key: bool,
    pub enabled: bool,
}

#[tauri::command]
pub async fn get_virustotal_status(state: State<'_, AppState>) -> CmdResult<VirusTotalStatus> {
    Ok(VirusTotalStatus {
        has_key: crate::vault::load(crate::safety::VT_KEY_ID).is_some_and(|k| !k.trim().is_empty()),
        enabled: state.db.get_setting("virustotal_enabled").await.as_deref() == Some("1"),
    })
}

/// Save the VirusTotal API key (in the Windows Credential Manager) after checking that VirusTotal accepts it.
#[tauri::command]
pub async fn set_virustotal_key(state: State<'_, AppState>, key: String) -> CmdResult<()> {
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err("Paste your VirusTotal API key first.".into());
    }
    crate::safety::check_key(&key).await?;
    crate::vault::store(crate::safety::VT_KEY_ID, &key)?;
    state.db.set_setting("virustotal_enabled", "1").await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_virustotal_key(state: State<'_, AppState>) -> CmdResult<()> {
    crate::vault::delete(crate::safety::VT_KEY_ID);
    state.db.set_setting("virustotal_enabled", "0").await.map_err(|e| e.to_string())
}

/// Look a finished download up on VirusTotal again (for example after the limit was reached).
#[tauri::command]
pub async fn rescan_virustotal(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let info = state.engine.info(&id).map_err(msg)?;
    if info.file_path.is_empty() {
        return Err("This download has no file to check.".into());
    }
    // Forget the old answer so the check runs again.
    let mut old = state.db.load_safety().await.unwrap_or_default().into_iter().find(|r| r.id == id);
    if let Some(r) = old.as_mut() {
        r.vt = None;
        let _ = state.db.save_safety(r).await;
    }
    tokio::spawn(crate::safety::on_completed(
        state.app_handle.clone(),
        state.db.clone(),
        id,
        info.file_name,
        info.file_path,
    ));
    Ok(())
}

/// A native "open file" / "save file" dialog. `extensions` filters by ending (without the dot).
#[tauri::command]
pub async fn pick_file(
    window: tauri::WebviewWindow,
    title: String,
    extensions: Vec<String>,
    save: bool,
    default_name: Option<String>,
) -> CmdResult<Option<String>> {
    tokio::task::spawn_blocking(move || {
        let mut dialog = rfd::FileDialog::new().set_title(&title).set_parent(&window);
        if !extensions.is_empty() {
            dialog = dialog.add_filter("Files", &extensions);
        }
        if let Some(n) = default_name.filter(|n| !n.is_empty()) {
            dialog = dialog.set_file_name(n);
        }
        let picked = if save { dialog.save_file() } else { dialog.pick_file() };
        Ok(picked.map(|p| p.to_string_lossy().to_string()))
    })
    .await
    .map_err(|e| format!("Task error: {e}"))?
}

#[tauri::command]
pub fn list_browser_profiles() -> Vec<crate::import_export::BrowserProfile> {
    crate::import_export::list_browser_profiles()
}

/// Read an import file (`kind`: idm, fdm, jdownloader, text, or browser with the History file path) and list what
/// it contains. Nothing is added yet; the dialog lets the user choose.
#[tauri::command]
pub async fn import_preview(kind: String, path: String) -> CmdResult<Vec<crate::import_export::ImportItem>> {
    if kind == "browser" {
        return crate::import_export::read_browser_history(Path::new(&path)).await;
    }
    let text = crate::import_export::read_import_file(Path::new(&path))?;
    crate::import_export::parse_import(&kind, &text)
}

/// Save settings, categories, queues and the download list (without passwords or cookies) to one file.
#[tauri::command]
pub async fn export_backup(state: State<'_, AppState>, path: String) -> CmdResult<usize> {
    let backup = crate::import_export::build_backup(&state.db, &state.engine).await?;
    let json = serde_json::to_string_pretty(&backup).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("Could not write the backup file: {e}"))?;
    Ok(backup.downloads.len())
}

#[tauri::command]
pub async fn restore_backup(state: State<'_, AppState>, path: String) -> CmdResult<crate::import_export::RestoreSummary> {
    let text = crate::import_export::read_import_file(Path::new(&path))?;
    let backup = crate::import_export::parse_backup(&text)?;
    let summary = crate::import_export::restore_backup(&state.db, &state.engine, backup).await?;
    state.bandwidth.refresh();
    Ok(summary)
}

/// What yt-dlp and ffmpeg are installed (and where they come from).
#[tauri::command]
pub async fn get_tools_status() -> CmdResult<Vec<crate::tools::ToolInfo>> {
    tokio::task::spawn_blocking(crate::tools::status).await.map_err(|e| e.to_string())
}

/// Install or update "yt-dlp" or "ffmpeg" (`force` installs again even when present).
#[tauri::command]
pub async fn install_tool(tool: String, force: bool) -> CmdResult<String> {
    crate::tools::install(&tool, force).await
}

#[tauri::command]
pub async fn get_license_status(state: State<'_, AppState>) -> CmdResult<crate::licensing::TrialAndLicenseStatus> {
    Ok(crate::licensing::get_status(&state.db).await)
}

#[tauri::command]
pub async fn activate_license_key(state: State<'_, AppState>, key: String) -> CmdResult<crate::licensing::TrialAndLicenseStatus> {
    let st = crate::licensing::activate_license(&state.db, &key).await.map_err(|e| e.to_string())?;
    state.engine.set_limits(st.max_connections, st.turbo_mode_allowed);
    Ok(st)
}

#[tauri::command]
pub async fn deactivate_license_key(state: State<'_, AppState>) -> CmdResult<crate::licensing::TrialAndLicenseStatus> {
    let st = crate::licensing::deactivate_license(&state.db).await.map_err(|e| e.to_string())?;
    state.engine.set_limits(st.max_connections, st.turbo_mode_allowed);
    Ok(st)
}


#[cfg(test)]
mod drive_tests {
    use super::*;

    /// Reads the real drives of this PC: `cargo test --lib live_list_drives -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_list_drives() {
        let drives = read_drives().expect("drives");
        for d in &drives {
            println!("{} [{}] {:?} free {} / {}", d.name, d.kind, d.label, d.free_bytes, d.total_bytes);
        }
        assert!(drives.iter().any(|d| d.name.to_uppercase().starts_with("C:")));
        assert!(drives.iter().all(|d| d.free_bytes <= d.total_bytes));
    }
}
