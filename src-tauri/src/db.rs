//! SQLite persistence (sqlx). The engine itself has no database: it emits
//! `EngineEvent::Persist(record)` and this module stores those records.
//!
//! Includes Phase 3 features:
//! - Categories (built-in and custom, default folders, extension associations)
//! - Queues and Scheduler configs

use std::path::Path;

use flowget_engine::{DomainBest, DomainHint, DownloadRecord};
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{Row, SqlitePool};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub name: String,
    pub extensions: Vec<String>,
    pub default_folder: String,
    pub is_builtin: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct QueueSchedule {
    pub enabled: bool,
    /// Format: "HH:MM:SS" or ISO timestamp
    pub start_time: Option<String>,
    /// Format: "HH:MM:SS" or ISO timestamp
    pub stop_time: Option<String>,
    /// Days of week: 0 = Sun, 1 = Mon, ..., 6 = Sat (empty = all days / one-shot)
    pub days_of_week: Vec<u8>,
    /// "none", "shutdown", "sleep", "hibernate", "exitApp", "runProgram"
    #[serde(default)]
    pub action_after_completion: String,
    pub run_program_path: Option<String>,
    pub wifi_only: bool,
    pub night_only: bool,
    pub night_start_hour: Option<u8>,
    pub night_end_hour: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueInfo {
    pub id: String,
    pub name: String,
    pub max_concurrent: u32,
    pub is_running: bool,
    pub schedule: Option<QueueSchedule>,
    pub created_at: i64,
}

#[derive(Clone)]
pub struct Db {
    pool: SqlitePool,
}

impl Db {
    pub async fn open(path: &Path, default_download_dir: &Path) -> Result<Self, sqlx::Error> {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Normal);
        let pool = SqlitePoolOptions::new().max_connections(5).connect_with(options).await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS downloads (
                id          TEXT PRIMARY KEY NOT NULL,
                state       TEXT NOT NULL,
                created_at  INTEGER NOT NULL,
                updated_at  INTEGER NOT NULL,
                record      TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS domain_stats (
                domain      TEXT PRIMARY KEY NOT NULL,
                connections INTEGER NOT NULL,
                speed_bps   INTEGER NOT NULL,
                updated_at  INTEGER NOT NULL
            )",
        )
        .execute(&pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS categories (
                id             TEXT PRIMARY KEY NOT NULL,
                name           TEXT NOT NULL,
                extensions     TEXT NOT NULL,
                default_folder TEXT NOT NULL,
                is_builtin     INTEGER NOT NULL
            )",
        )
        .execute(&pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS queues (
                id             TEXT PRIMARY KEY NOT NULL,
                name           TEXT NOT NULL,
                max_concurrent INTEGER NOT NULL,
                is_running     INTEGER NOT NULL,
                schedule       TEXT,
                created_at     INTEGER NOT NULL
            )",
        )
        .execute(&pool)
        .await?;

        let db = Self { pool };
        db.seed_defaults(default_download_dir).await?;
        Ok(db)
    }

    async fn seed_defaults(&self, default_dir: &Path) -> Result<(), sqlx::Error> {
        let cat_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM categories")
            .fetch_one(&self.pool)
            .await?;
        if cat_count == 0 {
            let def_str = default_dir.to_string_lossy();
            let builtins = vec![
                ("music", "Music", "mp3,wav,wma,m4a,aac,flac,ogg,opus,alac,aiff", format!("{def_str}\\Music")),
                ("compressed", "Compressed", "zip,rar,7z,tar,gz,bz2,xz,iso,tgz,z,dmg,cab", format!("{def_str}\\Compressed")),
                ("videos", "Videos", "mp4,mkv,avi,mov,wmv,flv,webm,m4v,mpeg,mpg,3gp", format!("{def_str}\\Videos")),
                ("programs", "Programs", "exe,msi,bat,cmd,sh,bin,appx,msix,com", format!("{def_str}\\Programs")),
                ("documents", "Documents", "pdf,doc,docx,xls,xlsx,ppt,pptx,txt,rtf,odt,csv,epub", format!("{def_str}\\Documents")),
                ("apks", "APKs", "apk,xapk,apks,aab", format!("{def_str}\\APKs")),
                ("images", "Images", "jpg,jpeg,png,gif,bmp,webp,svg,ico,tiff,psd", format!("{def_str}\\Images")),
                ("torrents", "Torrents", "torrent", format!("{def_str}\\Torrents")),
                ("others", "Others", "", format!("{def_str}\\Others")),
            ];
            for (id, name, exts, folder) in builtins {
                let _ = std::fs::create_dir_all(&folder);
                sqlx::query(
                    "INSERT OR IGNORE INTO categories (id, name, extensions, default_folder, is_builtin)
                     VALUES (?1, ?2, ?3, ?4, 1)",
                )
                .bind(id)
                .bind(name)
                .bind(exts)
                .bind(folder)
                .execute(&self.pool)
                .await?;
            }
        }

        // Ensure "torrents" category exists
        let def_str = default_dir.to_string_lossy();
        let torrent_folder = format!("{def_str}\\Torrents");
        let _ = std::fs::create_dir_all(&torrent_folder);
        let _ = sqlx::query(
            "INSERT OR IGNORE INTO categories (id, name, extensions, default_folder, is_builtin)
             VALUES ('torrents', 'Torrents', 'torrent', ?1, 1)",
        )
        .bind(torrent_folder)
        .execute(&self.pool)
        .await;

        let queue_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM queues")
            .fetch_one(&self.pool)
            .await?;
        if queue_count == 0 {
            sqlx::query(
                "INSERT INTO queues (id, name, max_concurrent, is_running, schedule, created_at)
                 VALUES ('main', 'Main Queue', 2, 1, NULL, strftime('%s','now'))",
            )
            .execute(&self.pool)
            .await?;
        }

        Ok(())
    }

    pub async fn load_categories(&self) -> Result<Vec<Category>, sqlx::Error> {
        let rows = sqlx::query("SELECT id, name, extensions, default_folder, is_builtin FROM categories ORDER BY is_builtin DESC, name ASC")
            .fetch_all(&self.pool)
            .await?;
        Ok(rows
            .into_iter()
            .map(|r| {
                let exts_str: String = r.get("extensions");
                let exts = exts_str
                    .split(',')
                    .map(|s| s.trim().to_lowercase())
                    .filter(|s| !s.is_empty())
                    .collect();
                Category {
                    id: r.get("id"),
                    name: r.get("name"),
                    extensions: exts,
                    default_folder: r.get("default_folder"),
                    is_builtin: r.get::<i64, _>("is_builtin") != 0,
                }
            })
            .collect())
    }

    pub async fn save_category(&self, cat: &Category) -> Result<(), sqlx::Error> {
        let exts_str = cat.extensions.join(",");
        sqlx::query(
            "INSERT INTO categories (id, name, extensions, default_folder, is_builtin)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                extensions = excluded.extensions,
                default_folder = excluded.default_folder,
                is_builtin = excluded.is_builtin",
        )
        .bind(&cat.id)
        .bind(&cat.name)
        .bind(&exts_str)
        .bind(&cat.default_folder)
        .bind(if cat.is_builtin { 1 } else { 0 })
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn delete_category(&self, id: &str) -> Result<(), sqlx::Error> {
        // Built-ins cannot be deleted
        sqlx::query("DELETE FROM categories WHERE id = ?1 AND is_builtin = 0")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn load_queues(&self) -> Result<Vec<QueueInfo>, sqlx::Error> {
        let rows = sqlx::query("SELECT id, name, max_concurrent, is_running, schedule, created_at FROM queues ORDER BY (id = 'main') DESC, created_at ASC")
            .fetch_all(&self.pool)
            .await?;
        Ok(rows
            .into_iter()
            .map(|r| {
                let sched_str: Option<String> = r.get("schedule");
                let schedule = sched_str.and_then(|s| serde_json::from_str(&s).ok());
                QueueInfo {
                    id: r.get("id"),
                    name: r.get("name"),
                    max_concurrent: r.get::<i64, _>("max_concurrent").max(1) as u32,
                    is_running: r.get::<i64, _>("is_running") != 0,
                    schedule,
                    created_at: r.get("created_at"),
                }
            })
            .collect())
    }

    pub async fn save_queue(&self, q: &QueueInfo) -> Result<(), sqlx::Error> {
        let sched_json = q.schedule.as_ref().and_then(|s| serde_json::to_string(s).ok());
        sqlx::query(
            "INSERT INTO queues (id, name, max_concurrent, is_running, schedule, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                max_concurrent = excluded.max_concurrent,
                is_running = excluded.is_running,
                schedule = excluded.schedule",
        )
        .bind(&q.id)
        .bind(&q.name)
        .bind(q.max_concurrent as i64)
        .bind(if q.is_running { 1 } else { 0 })
        .bind(sched_json)
        .bind(q.created_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn set_queue_running(&self, id: &str, is_running: bool) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE queues SET is_running = ?1 WHERE id = ?2")
            .bind(if is_running { 1 } else { 0 })
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn delete_queue(&self, id: &str) -> Result<(), sqlx::Error> {
        if id == "main" {
            return Ok(()); // main queue cannot be deleted
        }
        sqlx::query("DELETE FROM queues WHERE id = ?1").bind(id).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn upsert_domain(&self, d: &DomainBest) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO domain_stats (domain, connections, speed_bps, updated_at)
             VALUES (?1, ?2, ?3, strftime('%s','now'))
             ON CONFLICT(domain) DO UPDATE SET
                connections = excluded.connections,
                speed_bps = excluded.speed_bps,
                updated_at = excluded.updated_at",
        )
        .bind(&d.domain)
        .bind(d.connections as i64)
        .bind(d.speed_bps.min(i64::MAX as u64) as i64)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn load_domains(&self) -> Result<Vec<DomainHint>, sqlx::Error> {
        let rows = sqlx::query("SELECT domain, connections, speed_bps FROM domain_stats").fetch_all(&self.pool).await?;
        Ok(rows
            .into_iter()
            .map(|r| DomainHint {
                domain: r.get("domain"),
                connections: r.get::<i64, _>("connections").clamp(1, 32) as u32,
                speed_bps: r.get::<i64, _>("speed_bps").max(0) as u64,
            })
            .collect())
    }

    pub async fn upsert_download(&self, rec: &DownloadRecord) -> Result<(), sqlx::Error> {
        let json = serde_json::to_string(rec).map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
        sqlx::query(
            "INSERT INTO downloads (id, state, created_at, updated_at, record)
             VALUES (?1, ?2, ?3, strftime('%s','now'), ?4)
             ON CONFLICT(id) DO UPDATE SET
                state = excluded.state,
                updated_at = excluded.updated_at,
                record = excluded.record",
        )
        .bind(&rec.id)
        .bind(format!("{:?}", rec.state))
        .bind(rec.created_at)
        .bind(json)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn delete_download(&self, id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM downloads WHERE id = ?1").bind(id).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn load_downloads(&self) -> Result<Vec<DownloadRecord>, sqlx::Error> {
        let rows = sqlx::query("SELECT id, record FROM downloads ORDER BY created_at, id")
            .fetch_all(&self.pool)
            .await?;
        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            let id: String = row.get("id");
            let json: String = row.get("record");
            match serde_json::from_str::<DownloadRecord>(&json) {
                Ok(rec) => out.push(rec),
                Err(e) => eprintln!("[db] skipping unreadable download {id}: {e}"),
            }
        }
        Ok(out)
    }

    pub async fn get_setting(&self, key: &str) -> Option<String> {
        sqlx::query("SELECT value FROM settings WHERE key = ?1")
            .bind(key)
            .fetch_optional(&self.pool)
            .await
            .ok()
            .flatten()
            .map(|r| r.get::<String, _>("value"))
    }

    pub async fn set_setting(&self, key: &str, value: &str) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(key)
        .bind(value)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
