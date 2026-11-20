//! SQLite persistence (sqlx). The engine itself has no database: it emits
//! `EngineEvent::Persist(record)` and this module stores those records.
//!
//! Schema (v1): each download is one row whose `record` column holds the full
//! `DownloadRecord` as JSON (segments included). The few columns next to it exist so that later
//! phases (queues, history, search) can query without parsing JSON.

use std::path::Path;

use flowget_engine::{DomainBest, DomainHint, DownloadRecord};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{Row, SqlitePool};

#[derive(Clone)]
pub struct Db {
    pool: SqlitePool,
}

impl Db {
    pub async fn open(path: &Path) -> Result<Self, sqlx::Error> {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            // WAL: readers never block the writer, and a crash cannot corrupt the database.
            .journal_mode(SqliteJournalMode::Wal)
            // Safe with WAL: a power cut can lose the very last commit but never corrupt. Losing a
            // checkpoint only means re-downloading a second of data, which the engine tolerates.
            .synchronous(SqliteSynchronous::Normal);
        let pool = SqlitePoolOptions::new().max_connections(3).connect_with(options).await?;

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
        // Phase 2: the connection count that worked best per website.
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
        Ok(Self { pool })
    }

    /// Remember the best connection count for a website.
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

    /// All saved downloads, oldest first. Rows that no longer parse are skipped (and logged)
    /// rather than preventing the app from starting.
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
