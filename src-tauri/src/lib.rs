//! FlowGet desktop app: wires the download engine to the database, queue manager, and UI.

pub mod batch;
pub mod categories;
pub mod clipboard_watch;
pub mod commands;
pub mod db;
pub mod ipc_server;
pub mod licensing;
pub mod media_stream;
pub mod payload_check;
pub mod post_download;
pub mod protocols;
pub mod queue_manager;
pub mod site_grabber;
pub mod torrent;

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

pub fn run() {
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
            let (limit, conns, turbo, records, domains) = tauri::async_runtime::block_on(async {
                let limit = db.get_setting("global_speed_limit").await;
                let conns = db.get_setting("default_connections").await;
                let turbo = db.get_setting("turbo_mode").await;
                let records = db.load_downloads().await;
                let domains = db.load_domains().await;
                (limit, conns, turbo, records, domains)
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

            app.manage(AppState {
                engine,
                db,
                queue_mgr,
                torrent_mgr,
                app_handle: app.handle().clone(),
                shutting_down: AtomicBool::new(false),
            });
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
