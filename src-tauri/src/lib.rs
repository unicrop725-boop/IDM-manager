//! FlowGet desktop app: wires the download engine to the database, queue manager, and UI.

pub mod bandwidth;
pub mod batch;
pub mod categories;
pub mod clipboard_watch;
pub mod commands;
pub mod db;
pub mod import_export;
pub mod ipc_server;
pub mod licensing;
pub mod metered;
pub mod media_stream;
pub mod payload_check;
pub mod post_download;
pub mod protocols;
pub mod queue_manager;
pub mod safety;
pub mod site_grabber;
pub mod tools;
pub mod torrent;
pub mod vault;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use flowget_engine::{DownloadState, Engine, EngineConfig, EngineEvent};
use post_download::PostDownloadManager;
use queue_manager::QueueManager;
use tauri::{AppHandle, Emitter, Manager, RunEvent};
use tokio::sync::mpsc::UnboundedReceiver;

pub struct AppState {
    pub engine: Engine,
    pub db: db::Db,
    pub queue_mgr: Arc<QueueManager>,
    pub torrent_mgr: Arc<torrent::TorrentManager>,
    pub bandwidth: Arc<bandwidth::BandwidthManager>,
    pub app_handle: AppHandle,
    shutting_down: AtomicBool,
}

/// Forward engine events to the webview and database, and handle post-download automation.
async fn event_pump(app: AppHandle, db: db::Db, mut rx: UnboundedReceiver<EngineEvent>) {
    while let Some(event) = rx.recv().await {
        match event {
            EngineEvent::Progress(p) => {
                let _ = app.emit("download-progress", p);
            }
            EngineEvent::Updated(info) => {
                let _ = app.emit("download-updated", &info);

                // Check post-download automation when a download completes
                if info.state == DownloadState::Completed && !info.file_path.is_empty() {
                    let db_clone = db.clone();
                    let file_path = info.file_path.clone();
                    // Warn about risky names and (if switched on) look the file up on VirusTotal.
                    tokio::spawn(safety::on_completed(
                        app.clone(),
                        db.clone(),
                        info.id.clone(),
                        info.file_name.clone(),
                        info.file_path.clone(),
                    ));
                    tokio::spawn(async move {
                        let auto_extract = db_clone.get_setting("auto_extract").await.as_deref() == Some("1");
                        let virus_scan = db_clone.get_setting("virus_scan").await.as_deref() == Some("1");
                        let open_folder = db_clone.get_setting("open_folder_on_complete").await.as_deref() == Some("1");

                        if auto_extract && PostDownloadManager::is_archive(std::path::Path::new(&file_path)) {
                            let _ = PostDownloadManager::extract_archive(&file_path, None).await;
                        }
                        if virus_scan {
                            let _ = PostDownloadManager::scan_file(&file_path).await;
                        }
                        if open_folder {
                            let _ = PostDownloadManager::reveal_in_explorer(&file_path);
                        }
                    });
                }
            }
            EngineEvent::Persist(rec) => {
                if let Err(e) = db.upsert_download(&rec).await {
                    eprintln!("[db] could not save download {}: {e}", rec.id);
                }
            }
            EngineEvent::Removed(id) => {
                if let Err(e) = db.delete_download(&id).await {
                    eprintln!("[db] could not delete download {id}: {e}");
                }
                let _ = app.emit("download-removed", id);
            }
            EngineEvent::DomainBest(d) => {
                if let Err(e) = db.upsert_domain(&d).await {
                    eprintln!("[db] could not save connection count for {}: {e}", d.domain);
                }
            }
            EngineEvent::Flush(done) => {
                let _ = done.send(());
            }
        }
    }
}

/// True when another FlowGet already answers on the extension port (so a second copy must not start).
fn another_instance_running() -> bool {
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpStream};
    use std::time::Duration;

    let addr: SocketAddr = "127.0.0.1:21588".parse().expect("valid address");
    let Ok(mut s) = TcpStream::connect_timeout(&addr, Duration::from_millis(400)) else { return false };
    let _ = s.set_read_timeout(Some(Duration::from_millis(1500)));
    let _ = s.set_write_timeout(Some(Duration::from_millis(1500)));
    // /api/show also brings the running window to the front, which is what the user wanted by starting FlowGet again.
    if s.write_all(b"GET /api/show HTTP/1.1\r\nHost: 127.0.0.1:21588\r\nConnection: close\r\n\r\n").is_err() {
        return false;
    }
    let mut buf = String::new();
    let _ = s.take(4096).read_to_string(&mut buf);
    buf.starts_with("HTTP/1.1 200")
}

/// Make `flowget://...` links open this program, so the browser extension can start FlowGet when it is closed.
/// Per-user (HKCU), no administrator rights; rewritten on every start so it always points at the current exe.
#[cfg(windows)]
fn register_url_protocol() {
    use std::os::windows::process::CommandExt;
    let Ok(exe) = std::env::current_exe() else { return };
    let command = format!("\"{}\" \"%1\"", exe.display());
    let reg = |args: &[&str]| {
        let _ = std::process::Command::new("reg.exe").args(args).creation_flags(0x0800_0000).output();
    };
    reg(&["add", r"HKCU\Software\Classes\flowget", "/ve", "/d", "URL:FlowGet", "/f"]);
    reg(&["add", r"HKCU\Software\Classes\flowget", "/v", "URL Protocol", "/d", "", "/f"]);
    reg(&["add", r"HKCU\Software\Classes\flowget\shell\open\command", "/ve", "/d", &command, "/f"]);
}

#[cfg(not(windows))]
fn register_url_protocol() {}

/// Plain http(s) file downloads run in the engine and can simply be resumed. Everything else (magnet links,
/// torrent files, video pages) is handled by its own manager and is left alone.
fn auto_resumable(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    (lower.starts_with("http://") || lower.starts_with("https://"))
        && !media_stream::is_video_page_url(url)
        && !media_stream::is_manifest_url(url)
        && !lower.split(['?', '#']).next().unwrap_or("").ends_with(".torrent")
}

pub fn run() {
    if another_instance_running() {
        return;
    }
    // Managed yt-dlp / ffmpeg first on PATH, before any other thread starts programs.
    tools::prepend_to_path();
    std::thread::spawn(register_url_protocol);

    let app = tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;

            let default_dir = app
                .path()
                .download_dir()
                .or_else(|_| app.path().home_dir())
                .unwrap_or_else(|_| data_dir.clone());

            let db = tauri::async_runtime::block_on(db::Db::open(&data_dir.join("flowget.db"), &default_dir))?;

            let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
            let engine = Engine::new(EngineConfig::new(default_dir.clone()), tx);

            // Saved settings
            let (limit, conns, turbo, records, domains, resume_on_start) = tauri::async_runtime::block_on(async {
                let limit = db.get_setting("global_speed_limit").await;
                let conns = db.get_setting("default_connections").await;
                let turbo = db.get_setting("turbo_mode").await;
                let records = db.load_downloads().await;
                let domains = db.load_domains().await;
                let resume = db.get_setting("resume_on_start").await.as_deref() != Some("0"); // on by default
                (limit, conns, turbo, records, domains, resume)
            });

            engine.set_domain_hints(domains.unwrap_or_else(|e| {
                eprintln!("[db] could not load per-site connection counts: {e}");
                Vec::new()
            }));
            if let Some(v) = limit.and_then(|s| s.parse::<u64>().ok()) {
                engine.set_global_speed_limit(v);
            }
            if let Some(v) = conns.and_then(|s| s.parse::<u32>().ok()) {
                engine.set_default_connections(v);
            }
            engine.set_turbo_mode(turbo.as_deref() == Some("1"));

            engine.restore(records.unwrap_or_else(|e| {
                eprintln!("[db] could not load saved downloads: {e}");
                Vec::new()
            }));

            // Downloads that were running when the app last closed carry on by themselves (the user's own pauses stay).
            if resume_on_start {
                let eng = engine.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                    for (id, queue, url) in eng.interrupted() {
                        if !auto_resumable(&url) {
                            continue; // torrents, videos and other kinds are started by their own managers
                        }
                        // A download in a scheduled queue goes back to that queue; the rest start right away.
                        let queued_elsewhere = queue.as_deref().is_some_and(|q| q != "main");
                        let _ = if queued_elsewhere { eng.mark_queued(&id).await } else { eng.resume(&id).await };
                        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                    }
                });
            }

            tools::init(app.handle().clone());
            {
                let db = db.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(45)).await;
                    tools::auto_update(&db).await;
                });
            }

            tauri::async_runtime::spawn(event_pump(app.handle().clone(), db.clone(), rx));
            clipboard_watch::start(app.handle().clone(), db.clone());

            let supervisor = engine.clone();
            tauri::async_runtime::spawn(async move { supervisor.run_network_monitor().await });

            let queue_mgr = Arc::new(QueueManager::new(engine.clone(), db.clone(), app.handle().clone()));
            let q_clone = queue_mgr.clone();
            tauri::async_runtime::spawn(async move { q_clone.run_scheduler_loop().await });

            let ipc_server = Arc::new(ipc_server::IpcServer::new(app.handle().clone()));
            tauri::async_runtime::spawn(async move {
                let _ = ipc_server.run(21588).await;
            });

            let torrent_mgr = Arc::new(torrent::TorrentManager::new(default_dir.clone()));

            // Schedules, slow mode and metered-connection pausing, applied continuously.
            let bandwidth = bandwidth::BandwidthManager::new(engine.clone(), db.clone(), Some(app.handle().clone()));
            tauri::async_runtime::spawn(bandwidth.clone().run());

            app.manage(AppState {
                engine,
                db,
                queue_mgr,
                torrent_mgr,
                bandwidth,
                app_handle: app.handle().clone(),
                shutting_down: AtomicBool::new(false),
            });

            let window = match app.get_webview_window("main") {
                Some(w) => w,
                None => {
                    tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
                        .title("FlowGet")
                        .inner_size(1080.0, 720.0)
                        .min_inner_size(760.0, 460.0)
                        .center()
                        .build()?
                }
            };
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::add_download,
            commands::pause,
            commands::resume,
            commands::mark_queued,
            commands::cancel,
            commands::restart,
            commands::refresh_link,
            commands::remove,
            commands::get_downloads,
            commands::set_download_meta,
            commands::set_speed_limit,
            commands::check_duplicate,
            commands::get_categories,
            commands::save_category,
            commands::delete_category,
            commands::auto_categorize,
            commands::get_queues,
            commands::save_queue,
            commands::delete_queue,
            commands::set_queue_running,
            commands::reorder_queue,
            commands::move_to_queue,
            commands::extract_archive,
            commands::scan_file_defender,
            commands::open_folder,
            commands::open_file,
            commands::pick_folder,
            commands::get_disk_space,
            commands::list_drives,
            commands::update_download_path,
            commands::get_start_with_windows,
            commands::set_start_with_windows,
            commands::get_settings,
            commands::set_setting,
            commands::get_setting,
            commands::set_default_connections,
            commands::get_adapters,
            commands::set_turbo_mode,
            commands::expand_batch_patterns,
            commands::crawl_website,
            commands::resolve_video_media,
            commands::download_stream_media,
            commands::update_ytdlp,
            commands::get_tools_status,
            commands::install_tool,
            commands::get_bandwidth_policy,
            commands::set_bandwidth_policy,
            commands::set_slow_mode,
            commands::get_bandwidth_state,
            commands::set_metered_override,
            commands::get_safety_reports,
            commands::assess_file_name,
            commands::get_virustotal_status,
            commands::set_virustotal_key,
            commands::clear_virustotal_key,
            commands::rescan_virustotal,
            commands::pick_file,
            commands::open_url,
            commands::list_browser_profiles,
            commands::import_preview,
            commands::export_backup,
            commands::restore_backup,
            commands::get_license_status,
            commands::activate_license_key,
            commands::deactivate_license_key,
        ])
        .build(tauri::generate_context!())
        .expect("FlowGet could not start");

    app.run(|handle, event| {
        if let RunEvent::ExitRequested { code: None, api, .. } = &event {
            api.prevent_exit();
            let state = handle.state::<AppState>();
            if state.shutting_down.swap(true, Ordering::SeqCst) {
                return;
            }
            let engine = state.engine.clone();
            let handle = handle.clone();
            commands::stop_all_yt_jobs();
            tauri::async_runtime::spawn(async move {
                engine.shutdown().await;
                handle.exit(0);
            });
        }
    });
}
