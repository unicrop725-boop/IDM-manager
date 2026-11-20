//! FlowGet desktop app: wires the download engine to the database and the UI.
//!
//! - `engine` (separate crate) does all downloading and knows nothing about Tauri or SQL.
//! - `db` stores what the engine asks to persist.
//! - `commands` are thin Tauri wrappers around engine calls.
//! - The event pump below forwards engine events to the UI and to the database.

mod commands;
mod db;

use std::sync::atomic::{AtomicBool, Ordering};

use flowget_engine::{Engine, EngineConfig, EngineEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent};
use tokio::sync::mpsc::UnboundedReceiver;

pub struct AppState {
    pub engine: Engine,
    pub db: db::Db,
    shutting_down: AtomicBool,
}

/// Forward engine events to the webview and the database, in order.
async fn event_pump(app: AppHandle, db: db::Db, mut rx: UnboundedReceiver<EngineEvent>) {
    while let Some(event) = rx.recv().await {
        match event {
            EngineEvent::Progress(p) => {
                let _ = app.emit("download-progress", p);
            }
            EngineEvent::Updated(info) => {
                let _ = app.emit("download-updated", info);
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
            let db = tauri::async_runtime::block_on(db::Db::open(&data_dir.join("flowget.db")))?;

            // Where downloads go by default.
            let default_dir = app
                .path()
                .download_dir()
                .or_else(|_| app.path().home_dir())
                .unwrap_or_else(|_| data_dir.clone());

            let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
            let engine = Engine::new(EngineConfig::new(default_dir), tx);

            // Saved settings.
            let (limit, conns, turbo, records, domains) = tauri::async_runtime::block_on(async {
                let limit = db.get_setting("global_speed_limit").await;
                let conns = db.get_setting("default_connections").await;
                let turbo = db.get_setting("turbo_mode").await;
                let records = db.load_downloads().await;
                let domains = db.load_domains().await;
                (limit, conns, turbo, records, domains)
            });
            // The connection count that worked best per website, learned by earlier downloads.
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
            // Anything that was running when the app last closed (or crashed) comes back paused,
            // with its saved progress.
            engine.restore(records.unwrap_or_else(|e| {
                eprintln!("[db] could not load saved downloads: {e}");
                Vec::new()
            }));

            tauri::async_runtime::spawn(event_pump(app.handle().clone(), db.clone(), rx));
            // Watches the network for the lifetime of the app: when the internet drops, downloads
            // wait; when it returns, they resume by themselves.
            let supervisor = engine.clone();
            tauri::async_runtime::spawn(async move { supervisor.run_network_monitor().await });
            app.manage(AppState { engine, db, shutting_down: AtomicBool::new(false) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::add_download,
            commands::pause,
            commands::resume,
            commands::cancel,
            commands::restart,
            commands::refresh_link,
            commands::remove,
            commands::get_downloads,
            commands::set_speed_limit,
            commands::get_settings,
            commands::set_default_connections,
            commands::get_adapters,
            commands::set_turbo_mode,
        ])
        .build(tauri::generate_context!())
        .expect("FlowGet could not start");

    app.run(|handle, event| {
        // The last window was closed (code == None): do not exit yet. First pause every running
        // download so all buffered data is written and the final progress is in the database.
        if let RunEvent::ExitRequested { code: None, api, .. } = &event {
            api.prevent_exit();
            let state = handle.state::<AppState>();
            if state.shutting_down.swap(true, Ordering::SeqCst) {
                return; // already shutting down
            }
            let engine = state.engine.clone();
            let handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                engine.shutdown().await;
                handle.exit(0);
            });
        }
    });
}
