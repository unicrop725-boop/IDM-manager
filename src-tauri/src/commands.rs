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
    pub portable_mode: bool,
    pub mobile_sharing_enabled: bool,
    pub bandwidth_monitor_enabled: bool,
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
    state.engine.pause(&id).await.map_err(msg)
}

#[tauri::command]
pub async fn resume(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.engine.resume(&id).await.map_err(msg)
}

#[tauri::command]
pub async fn mark_queued(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.engine.mark_queued(&id).await.map_err(msg)
}

#[tauri::command]
pub async fn cancel(state: State<'_, AppState>, id: String) -> CmdResult<()> {
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
    state.engine.remove(&id, delete_file).await.map_err(msg)
}

#[tauri::command]
pub fn get_downloads(state: State<'_, AppState>) -> Vec<DownloadInfo> {
    state.engine.list()
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
            state
                .db
                .set_setting("global_speed_limit", &bytes_per_sec.to_string())
                .await
                .map_err(|e| format!("Could not save setting: {e}"))
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

#[tauri::command]
pub fn open_file(path: String) -> CmdResult<()> {
    PostDownloadManager::open_file(&path)
}

#[tauri::command]
pub fn get_start_with_windows() -> bool {
    #[cfg(target_os = "windows")]
    {
        let out = std::process::Command::new("reg.exe")
            .args(["query", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run", "/v", "FlowGet"])
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
            let status = std::process::Command::new("reg.exe")
                .args([
                    "add",
                    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                    "/v",
                    "FlowGet",
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
            let _status = std::process::Command::new("reg.exe")
                .args([
                    "delete",
                    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                    "/v",
                    "FlowGet",
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
    let portable_mode = state.db.get_setting("portable_mode").await.as_deref() == Some("1");
    let mobile_sharing = state.db.get_setting("mobile_sharing_enabled").await.as_deref() != Some("0"); // default true
    let bandwidth_monitor = state.db.get_setting("bandwidth_monitor_enabled").await.as_deref() != Some("0"); // default true

    Ok(Settings {
        global_speed_limit: state.engine.global_speed_limit(),
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
        portable_mode,
        mobile_sharing_enabled: mobile_sharing,
        bandwidth_monitor_enabled: bandwidth_monitor,
    })
}

#[tauri::command]
pub async fn set_setting(state: State<'_, AppState>, key: String, value: String) -> CmdResult<()> {
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
        return Err("Turbo Mode requires an active 30-day trial or FlowGet Lifetime license.".to_string());
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
        return Err("Media stream downloading requires an active 30-day trial or FlowGet Pro license.".to_string());
    }

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

#[tauri::command]
pub async fn update_ytdlp() -> CmdResult<String> {
    crate::media_stream::auto_update_ytdlp().await
}

#[tauri::command]
pub async fn get_license_status(state: State<'_, AppState>) -> CmdResult<crate::licensing::TrialAndLicenseStatus> {
    Ok(crate::licensing::get_status(&state.db).await)
}

#[tauri::command]
pub async fn activate_license_key(state: State<'_, AppState>, key: String) -> CmdResult<crate::licensing::TrialAndLicenseStatus> {
    crate::licensing::activate_license(&state.db, &key).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn deactivate_license_key(state: State<'_, AppState>) -> CmdResult<crate::licensing::TrialAndLicenseStatus> {
    crate::licensing::deactivate_license(&state.db).await.map_err(|e| e.to_string())
}
