//! BitTorrent & Magnet link manager using librqbit.
//! Categorizes downloads as "Torrents".

use std::path::{Path, PathBuf};
use std::sync::Arc;

use librqbit::{AddTorrent, AddTorrentOptions, Session, SessionOptions};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentStatus {
    pub id: String,
    pub name: String,
    pub progress: f64,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub live_speed_bps: u64,
    pub state: String,
}

pub struct TorrentManager {
    session: Arc<RwLock<Option<Arc<Session>>>>,
    default_dir: PathBuf,
}

impl TorrentManager {
    pub fn new(default_dir: PathBuf) -> Self {
        Self {
            session: Arc::new(RwLock::new(None)),
            default_dir,
        }
    }

    /// Check if a link is a magnet or torrent link
    pub fn is_torrent(url: &str) -> bool {
        let trimmed = url.trim().to_lowercase();
        trimmed.starts_with("magnet:?") || trimmed.ends_with(".torrent")
    }

    async fn get_or_init_session(&self) -> Result<Arc<Session>, String> {
        let mut guard = self.session.write().await;
        if let Some(ref s) = *guard {
            return Ok(s.clone());
        }

        let torrent_dir = self.default_dir.join("Torrents");
        std::fs::create_dir_all(&torrent_dir).map_err(|e| format!("Could not create torrent dir: {e}"))?;

        let opts = SessionOptions::default();

        let session = Session::new_with_opts(torrent_dir, opts)
            .await
            .map_err(|e| format!("Failed to create librqbit session: {e}"))?;

        *guard = Some(session.clone());
        Ok(session)
    }

    /// Add a magnet or torrent link to download
    pub async fn add(&self, magnet_url: &str, output_folder: Option<&Path>) -> Result<String, String> {
        let session = self.get_or_init_session().await?;
        let add_opts = AddTorrentOptions {
            output_folder: output_folder.map(|p| p.to_string_lossy().to_string()),
            ..Default::default()
        };

        let add_torrent = AddTorrent::from_url(magnet_url);
        let resp = session
            .add_torrent(add_torrent, Some(add_opts))
            .await
            .map_err(|e| format!("librqbit add_torrent error: {e}"))?;

        match resp {
            librqbit::AddTorrentResponse::Added(handle_id, _) => Ok(format!("{handle_id}")),
            librqbit::AddTorrentResponse::AlreadyManaged(handle_id, _) => Ok(format!("{handle_id}")),
            librqbit::AddTorrentResponse::ListOnly(_) => Ok("list_only".to_string()),
        }
    }
}
