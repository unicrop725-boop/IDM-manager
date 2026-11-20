//! Tauri commands: a thin layer over the engine. No download logic lives here.
//! Errors are returned as plain-language strings (project rule 6).

use flowget_engine::{AddRequest, DownloadInfo, MAX_CONNECTIONS, MIN_CONNECTIONS};
use serde::Serialize;
use tauri::State;

use crate::AppState;

type CmdResult<T> = Result<T, String>;

fn msg(e: flowget_engine::EngineError) -> String {
    e.user_message()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// Bytes per second, 0 = unlimited.
    pub global_speed_limit: u64,
    pub default_connections: u32,
    pub min_connections: u32,
    pub max_connections: u32,
    pub download_dir: String,
    /// Whether the internet is currently believed to be reachable.
    pub online: bool,
}

/// Add a download and start it (unless `startPaused`).
#[tauri::command]
pub async fn add_download(state: State<'_, AppState>, request: AddRequest) -> CmdResult<DownloadInfo> {
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

/// Stop and delete the partial file; the entry stays in the list as "Cancelled".
#[tauri::command]
pub async fn cancel(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.engine.cancel(&id).await.map_err(msg)
}

/// Give an expired download a fresh link for the same file; it continues from where it stopped.
#[tauri::command]
pub async fn refresh_link(state: State<'_, AppState>, id: String, new_url: String) -> CmdResult<()> {
    state.engine.refresh_link(&id, &new_url).await.map_err(msg)
}

/// Start again from byte 0.
#[tauri::command]
pub async fn restart(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.engine.restart(&id).await.map_err(msg)
}

/// Remove from the list. `delete_file` only matters for finished downloads.
#[tauri::command]
pub async fn remove(state: State<'_, AppState>, id: String, delete_file: bool) -> CmdResult<()> {
    state.engine.remove(&id, delete_file).await.map_err(msg)
}

#[tauri::command]
pub fn get_downloads(state: State<'_, AppState>) -> Vec<DownloadInfo> {
    state.engine.list()
}

/// Set a speed limit in bytes/second (0 = unlimited). `id = None` sets the global limit.
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
                .map_err(|e| format!("Could not save the setting: {e}"))
        }
    }
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    Settings {
        global_speed_limit: state.engine.global_speed_limit(),
        default_connections: state.engine.default_connections(),
        min_connections: MIN_CONNECTIONS,
        max_connections: MAX_CONNECTIONS,
        download_dir: state.engine.default_dir().to_string_lossy().to_string(),
        online: state.engine.is_online(),
    }
}

#[tauri::command]
pub async fn set_default_connections(state: State<'_, AppState>, connections: u32) -> CmdResult<u32> {
    state.engine.set_default_connections(connections);
    let applied = state.engine.default_connections();
    state
        .db
        .set_setting("default_connections", &applied.to_string())
        .await
        .map_err(|e| format!("Could not save the setting: {e}"))?;
    Ok(applied)
}
