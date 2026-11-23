//! Moving in and out of FlowGet: link lists from IDM, FDM, JDownloader and the browser's own download history, and a
//! one-file backup of settings and history that can be restored on this or another PC.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::Row;

use crate::db::{Category, Db, QueueInfo};
use flowget_engine::{DownloadRecord, Engine};

/// One download found in an import file.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct ImportItem {
    pub url: String,
    pub file_name: Option<String>,
    pub referer: Option<String>,
    pub cookies: Option<String>,
    pub user_agent: Option<String>,
    pub save_dir: Option<String>,
    pub size: Option<u64>,
    /// Extra information shown in the preview, e.g. when the browser downloaded it.
    pub note: Option<String>,
}

fn item(url: &str) -> ImportItem {
    ImportItem { url: url.to_string(), ..Default::default() }
}

fn is_downloadable(url: &str) -> bool {
    let u = url.to_ascii_lowercase();
    (u.starts_with("http://") || u.starts_with("https://") || u.starts_with("ftp://") || u.starts_with("magnet:?"))
        && url::Url::parse(url).is_ok()
}

/// Every link in any text (a list, a JSON or XML export, a bookmark page), in order, without repeats.
pub fn extract_urls(text: &str) -> Vec<String> {
    let text = text.replace("\\/", "/").replace("&amp;", "&");
    let mut out: Vec<String> = Vec::new();
    // ASCII lower-casing keeps every byte offset, so positions found here are valid in `text` too.
    let lower = text.to_ascii_lowercase();
    let starts = ["https://", "http://", "ftp://", "magnet:?"];
    let mut at = 0;
    while let Some(rel) = starts.iter().filter_map(|s| lower[at..].find(s)).min() {
        let start = at + rel;
        let tail = &text[start..];
        let end = tail
            .find(|c: char| c.is_whitespace() || matches!(c, '<' | '>' | '"' | '\'' | '\\' | '|' | '^' | '`'))
            .unwrap_or(tail.len());
        let url = tail[..end].trim_end_matches(['.', ',', ';', ')', ']', '}', '!']);
        if is_downloadable(url) && !out.iter().any(|u| u == url) {
            out.push(url.to_string());
        }
        at = start + end.max(1);
    }
    out
}

/// IDM "Export" file (`.ef2`): blocks of `<` / address / `header: value` lines / `>`.
pub fn parse_idm(text: &str) -> Vec<ImportItem> {
    let mut items = Vec::new();
    let mut cur: Option<ImportItem> = None;
    for raw in text.lines() {
        let line = raw.trim().trim_start_matches('\u{feff}');
        if line == "<" {
            cur = Some(ImportItem::default());
        } else if line == ">" {
            if let Some(i) = cur.take() {
                if is_downloadable(&i.url) {
                    items.push(i);
                }
            }
        } else if let Some(i) = cur.as_mut() {
            if i.url.is_empty() && is_downloadable(line) {
                i.url = line.to_string();
            } else if let Some((k, v)) = line.split_once(':') {
                let v = v.trim();
                if v.is_empty() {
                    continue;
                }
                match k.trim().to_ascii_lowercase().as_str() {
                    "referer" | "referrer" => i.referer = Some(v.to_string()),
                    "cookie" => i.cookies = Some(v.to_string()),
                    "user-agent" => i.user_agent = Some(v.to_string()),
                    "filename" => i.file_name = Some(v.to_string()),
                    "saveto" | "savepath" => i.save_dir = Some(v.to_string()),
                    _ => {}
                }
            }
        }
    }
    items
}

/// JDownloader link grabber jobs (`.crawljob`): JSON, or `key=value` blocks.
pub fn parse_jdownloader(text: &str) -> Vec<ImportItem> {
    let mut items = Vec::new();
    let mut from_entry = |text: Option<&str>, folder: Option<&str>, name: Option<&str>| {
        for url in extract_urls(text.unwrap_or("")) {
            let mut i = item(&url);
            i.save_dir = folder.filter(|f| !f.is_empty()).map(str::to_string);
            i.file_name = name.filter(|n| !n.is_empty()).map(str::to_string);
            items.push(i);
        }
    };
    let trimmed = text.trim_start_matches('\u{feff}').trim();
    if trimmed.starts_with('[') || trimmed.starts_with('{') {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
            let entries: Vec<&serde_json::Value> = match &v {
                serde_json::Value::Array(a) => a.iter().collect(),
                other => vec![other],
            };
            for e in entries {
                let s = |k: &str| e.get(k).and_then(|x| x.as_str());
                from_entry(s("text").or(s("url")).or(s("link")), s("downloadFolder"), s("filename"));
            }
            return items;
        }
    }
    // key=value blocks ("->NEW ENTRY<-" separated, or blank-line separated)
    let (mut text_v, mut folder, mut name) = (String::new(), String::new(), String::new());
    let mut flush = |t: &mut String, f: &mut String, n: &mut String| {
        if !t.is_empty() {
            from_entry(Some(t), Some(f), Some(n));
        }
        t.clear();
        f.clear();
        n.clear();
    };
    for line in trimmed.lines() {
        let l = line.trim();
        if l.is_empty() || l.starts_with("->NEW ENTRY") {
            flush(&mut text_v, &mut folder, &mut name);
        } else if let Some((k, v)) = l.split_once('=') {
            match k.trim().to_ascii_lowercase().as_str() {
                "text" => {
                    text_v.push_str(v.trim());
                    text_v.push(' ');
                }
                "downloadfolder" => folder = v.trim().to_string(),
                "filename" => name = v.trim().to_string(),
                _ => {}
            }
        }
    }
    flush(&mut text_v, &mut folder, &mut name);
    if items.is_empty() {
        items = extract_urls(trimmed).iter().map(|u| item(u)).collect();
    }
    items
}

/// Read an import file. `kind`: idm | jdownloader | fdm | text (fdm and text take any list or export with links in it).
pub fn parse_import(kind: &str, text: &str) -> Result<Vec<ImportItem>, String> {
    let items = match kind {
        "idm" => {
            let found = parse_idm(text);
            // IDM can also export a plain text list of addresses.
            if found.is_empty() { extract_urls(text).iter().map(|u| item(u)).collect() } else { found }
        }
        "jdownloader" => parse_jdownloader(text),
        "fdm" | "text" => extract_urls(text).iter().map(|u| item(u)).collect(),
        other => return Err(format!("Unknown import type \"{other}\".")),
    };
    if items.is_empty() {
        return Err("No download links were found in this file. Check that you chose the right program and file.".into());
    }
    Ok(items)
}

pub fn read_import_file(path: &Path) -> Result<String, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("Could not open the file: {e}"))?;
    if meta.len() > 50 * 1024 * 1024 {
        return Err("This file is too large to be a download list (over 50 MB).".into());
    }
    let bytes = std::fs::read(path).map_err(|e| format!("Could not read the file: {e}"))?;
    // Some Windows programs write UTF-16.
    if bytes.starts_with(&[0xFF, 0xFE]) || bytes.starts_with(&[0xFE, 0xFF]) {
        let le = bytes[0] == 0xFF;
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| if le { u16::from_le_bytes([c[0], c[1]]) } else { u16::from_be_bytes([c[0], c[1]]) })
            .collect();
        return Ok(String::from_utf16_lossy(&units));
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

// ---------------------------------------------------------------------------------------------------------------
// Browser history

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserProfile {
    pub browser: String,
    pub profile: String,
    pub path: String,
}

/// Chrome, Edge and Brave profiles that have a download history on this PC.
pub fn list_browser_profiles() -> Vec<BrowserProfile> {
    let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) else { return Vec::new() };
    let browsers = [
        ("Google Chrome", "Google/Chrome/User Data"),
        ("Microsoft Edge", "Microsoft/Edge/User Data"),
        ("Brave", "BraveSoftware/Brave-Browser/User Data"),
    ];
    let mut out = Vec::new();
    for (name, rel) in browsers {
        let root = local.join(rel);
        let Ok(entries) = std::fs::read_dir(&root) else { continue };
        let mut profiles: Vec<String> = entries
            .flatten()
            .filter(|e| e.path().join("History").is_file())
            .filter_map(|e| e.file_name().into_string().ok())
            .filter(|n| n == "Default" || n.starts_with("Profile "))
            .collect();
        profiles.sort();
        // Chrome-style browsers keep the names people gave their profiles in "Local State".
        let names: serde_json::Value = std::fs::read_to_string(root.join("Local State"))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        for p in profiles {
            let label = names["profile"]["info_cache"][&p]["name"].as_str().filter(|n| !n.is_empty()).unwrap_or(&p).to_string();
            out.push(BrowserProfile { browser: name.into(), path: root.join(&p).join("History").to_string_lossy().into_owned(), profile: label });
        }
    }
    out
}

/// The files a browser downloaded, newest first (from a copy of its history, which the browser may have locked).
pub async fn read_browser_history(history: &Path) -> Result<Vec<ImportItem>, String> {
    let tmp = tempfile::Builder::new().prefix("flowget-history").tempdir().map_err(|e| e.to_string())?;
    let copy = tmp.path().join("History");
    std::fs::copy(history, &copy)
        .map_err(|e| format!("Could not read the browser's history ({e}). Close the browser and try again."))?;
    let options = SqliteConnectOptions::new().filename(&copy).read_only(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|e| format!("This does not look like a browser history file: {e}"))?;
    let rows = sqlx::query(
        "SELECT d.target_path AS path, d.total_bytes AS size, d.tab_url AS tab, d.referrer AS referrer, d.start_time AS started,
                (SELECT c.url FROM downloads_url_chains c WHERE c.id = d.id ORDER BY c.chain_index DESC LIMIT 1) AS url
         FROM downloads d ORDER BY d.start_time DESC LIMIT 2000",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("This browser's history has no download list: {e}"))?;
    pool.close().await;

    let mut out = Vec::new();
    for r in rows {
        let Some(url) = r.try_get::<Option<String>, _>("url").ok().flatten().filter(|u| is_downloadable(u)) else { continue };
        let path: String = r.try_get("path").unwrap_or_default();
        let referrer: String = r.try_get("referrer").unwrap_or_default();
        let tab: String = r.try_get("tab").unwrap_or_default();
        let size: i64 = r.try_get("size").unwrap_or(0);
        let started: i64 = r.try_get("started").unwrap_or(0);
        // Chrome counts microseconds from 1601-01-01.
        let when = chrono::DateTime::from_timestamp(started / 1_000_000 - 11_644_473_600, 0)
            .map(|d| d.format("%d %b %Y").to_string());
        out.push(ImportItem {
            url,
            file_name: Path::new(&path.replace('\\', "/")).file_name().map(|n| n.to_string_lossy().into_owned()).filter(|n| !n.is_empty()),
            referer: Some(if referrer.is_empty() { tab } else { referrer }).filter(|s| !s.is_empty()),
            size: (size > 0).then_some(size as u64),
            note: when.map(|w| format!("Downloaded {w}")),
            ..Default::default()
        });
    }
    Ok(out)
}

// ---------------------------------------------------------------------------------------------------------------
// Backup and restore

const BACKUP_FORMAT: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Backup {
    pub app: String,
    pub format: u32,
    pub created_at: i64,
    pub settings: BTreeMap<String, String>,
    pub categories: Vec<Category>,
    pub queues: Vec<QueueInfo>,
    pub downloads: Vec<DownloadRecord>,
}

impl Default for Backup {
    fn default() -> Self {
        Self {
            app: "FlowGet".into(),
            format: BACKUP_FORMAT,
            created_at: 0,
            settings: BTreeMap::new(),
            categories: Vec::new(),
            queues: Vec::new(),
            downloads: Vec::new(),
        }
    }
}

/// Settings that must never travel in a backup file.
fn is_secret_setting(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    ["key", "license", "token", "secret", "password"].iter().any(|s| k.contains(s))
}

/// A download record without anything that could log someone in: passwords, cookies and request headers.
fn scrubbed(mut rec: DownloadRecord) -> DownloadRecord {
    rec.http.password = None;
    rec.http.cookies = None;
    rec.http.headers.clear();
    rec.interrupted = false;
    rec
}

pub async fn build_backup(db: &Db, engine: &Engine) -> Result<Backup, String> {
    let settings = db
        .all_settings()
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter(|(k, _)| !is_secret_setting(k))
        .collect();
    let mut downloads: Vec<DownloadRecord> = engine.list().iter().filter_map(|i| engine.record(&i.id)).map(scrubbed).collect();
    downloads.sort_by_key(|d| d.created_at);
    Ok(Backup {
        created_at: chrono::Utc::now().timestamp(),
        settings,
        categories: db.load_categories().await.map_err(|e| e.to_string())?,
        queues: db.load_queues().await.map_err(|e| e.to_string())?,
        downloads,
        ..Default::default()
    })
}

pub fn parse_backup(text: &str) -> Result<Backup, String> {
    let b: Backup = serde_json::from_str(text)
        .map_err(|_| "This is not a FlowGet backup file (or it is damaged).".to_string())?;
    if b.app != "FlowGet" {
        return Err("This is not a FlowGet backup file.".into());
    }
    if b.format > BACKUP_FORMAT {
        return Err("This backup was made by a newer FlowGet. Update FlowGet and try again.".into());
    }
    Ok(b)
}

#[derive(Debug, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RestoreSummary {
    pub settings: usize,
    pub categories: usize,
    pub queues: usize,
    pub downloads: usize,
    pub skipped_downloads: usize,
}

/// Put a backup back. Downloads that already exist here (same id) are left alone; nothing is deleted.
pub async fn restore_backup(db: &Db, engine: &Engine, backup: Backup) -> Result<RestoreSummary, String> {
    let mut summary = RestoreSummary::default();
    for (k, v) in &backup.settings {
        if is_secret_setting(k) {
            continue;
        }
        db.set_setting(k, v).await.map_err(|e| e.to_string())?;
        summary.settings += 1;
    }
    for c in &backup.categories {
        db.save_category(c).await.map_err(|e| e.to_string())?;
        summary.categories += 1;
    }
    for q in &backup.queues {
        db.save_queue(q).await.map_err(|e| e.to_string())?;
        summary.queues += 1;
    }
    let have: std::collections::HashSet<String> = engine.list().into_iter().map(|d| d.id).collect();
    let mut fresh = Vec::new();
    for rec in backup.downloads {
        if have.contains(&rec.id) {
            summary.skipped_downloads += 1;
            continue;
        }
        db.upsert_download(&scrubbed(rec.clone())).await.map_err(|e| e.to_string())?;
        fresh.push(scrubbed(rec));
        summary.downloads += 1;
    }
    engine.restore(fresh);

    // The numbers the engine keeps in memory.
    if let Some(v) = db.get_setting("global_speed_limit").await.and_then(|s| s.parse::<u64>().ok()) {
        engine.set_global_speed_limit(v);
    }
    if let Some(v) = db.get_setting("default_connections").await.and_then(|s| s.parse::<u32>().ok()) {
        engine.set_default_connections(v);
    }
    engine.set_turbo_mode(db.get_setting("turbo_mode").await.as_deref() == Some("1"));
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    const EF2: &str = "<\r\nhttp://example.com/files/setup.zip\r\ncookie: sid=abc123; theme=dark\r\nreferer: http://example.com/downloads\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0)\r\n>\r\n<\r\nhttps://cdn.example.org/video.mp4\r\n>\r\n<\r\nnot-a-link\r\n>\r\n";

    #[test]
    fn idm_export_keeps_links_and_the_session_details() {
        let items = parse_idm(EF2);
        assert_eq!(items.len(), 2, "{items:?}");
        assert_eq!(items[0].url, "http://example.com/files/setup.zip");
        assert_eq!(items[0].cookies.as_deref(), Some("sid=abc123; theme=dark"));
        assert_eq!(items[0].referer.as_deref(), Some("http://example.com/downloads"));
        assert!(items[0].user_agent.as_deref().unwrap().starts_with("Mozilla"));
        assert_eq!(items[1].url, "https://cdn.example.org/video.mp4");
        assert!(items[1].cookies.is_none());
    }

    #[test]
    fn idm_plain_text_lists_work_through_the_same_path() {
        let items = parse_import("idm", "http://a.com/1.zip\nhttp://a.com/2.zip\n").unwrap();
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn jdownloader_json_and_key_value_jobs_are_read() {
        let json = r#"[{"text":"https:\/\/host.com\/a.rar https://host.com/b.rar","downloadFolder":"D:\\Stuff","filename":"","packageName":"p"},
                       {"text":"magnet:?xt=urn:btih:abcdef&dn=x","autoStart":"TRUE"}]"#;
        let items = parse_jdownloader(json);
        assert_eq!(items.len(), 3, "{items:?}");
        assert_eq!(items[0].url, "https://host.com/a.rar");
        assert_eq!(items[0].save_dir.as_deref(), Some("D:\\Stuff"));
        assert!(items[2].url.starts_with("magnet:?"));

        let kv = "->NEW ENTRY<-\ntext=http://h.com/x.zip\ndownloadFolder=C:\\dl\nfilename=my.zip\n\n->NEW ENTRY<-\ntext=http://h.com/y.zip\n";
        let items = parse_jdownloader(kv);
        assert_eq!(items.len(), 2, "{items:?}");
        assert_eq!(items[0].file_name.as_deref(), Some("my.zip"));
        assert_eq!(items[1].save_dir, None);
    }

    #[test]
    fn links_are_found_in_any_text_once_and_without_trailing_punctuation() {
        let text = "See (https://a.com/f.zip), also <a href=\"http://b.com/x?y=1&amp;z=2\">x</a> and https://a.com/f.zip again. ftp://ftp.c.org/p.iso. Visit javascript:alert(1)";
        let urls = extract_urls(text);
        assert_eq!(urls, vec!["https://a.com/f.zip", "http://b.com/x?y=1&z=2", "ftp://ftp.c.org/p.iso"]);
        assert!(parse_import("text", "nothing here").is_err());
        assert!(parse_import("nope", "http://a.com").is_err());
    }

    #[tokio::test]
    async fn browser_history_is_read_from_a_copy_of_a_chrome_style_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("History");
        let opts = SqliteConnectOptions::new().filename(&path).create_if_missing(true);
        let pool = SqlitePoolOptions::new().max_connections(1).connect_with(opts).await.unwrap();
        for q in [
            "CREATE TABLE downloads (id INTEGER PRIMARY KEY, target_path TEXT, total_bytes INTEGER, tab_url TEXT, referrer TEXT, start_time INTEGER)",
            "CREATE TABLE downloads_url_chains (id INTEGER, chain_index INTEGER, url TEXT)",
            // 2024-05-01 in Chrome's time (microseconds since 1601)
            "INSERT INTO downloads VALUES (1, 'C:\\\\Users\\\\x\\\\Downloads\\\\tool.zip', 5242880, 'https://site.com/page', 'https://site.com/', 13359000000000000)",
            "INSERT INTO downloads_url_chains VALUES (1, 0, 'https://short.link/abc')",
            "INSERT INTO downloads_url_chains VALUES (1, 1, 'https://cdn.site.com/tool.zip')",
            "INSERT INTO downloads VALUES (2, 'C:\\\\a.bin', 0, '', '', 13359000000000001)",
            "INSERT INTO downloads_url_chains VALUES (2, 0, 'blob:https://x/1')",
        ] {
            sqlx::query(q).execute(&pool).await.unwrap();
        }
        pool.close().await;

        let items = read_browser_history(&path).await.unwrap();
        assert_eq!(items.len(), 1, "the blob: download cannot be repeated: {items:?}");
        assert_eq!(items[0].url, "https://cdn.site.com/tool.zip", "the final address of the redirect chain");
        assert_eq!(items[0].file_name.as_deref(), Some("tool.zip"));
        assert_eq!(items[0].size, Some(5_242_880));
        assert_eq!(items[0].referer.as_deref(), Some("https://site.com/"));
        assert!(items[0].note.as_deref().unwrap().starts_with("Downloaded "));
        assert!(read_browser_history(&dir.path().join("missing")).await.is_err());
    }

    /// Reads this PC's real browsers (prints counts only): `cargo test --lib live_browser_history -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn live_browser_history() {
        for p in list_browser_profiles() {
            match read_browser_history(Path::new(&p.path)).await {
                Ok(items) => println!("{} / {}: {} downloads found", p.browser, p.profile, items.len()),
                Err(e) => println!("{} / {}: {e}", p.browser, p.profile),
            }
        }
    }

    #[test]
    fn secrets_stay_out_of_a_backup() {
        for k in ["license_key", "activation_token", "virustotal_api_key", "proxy_password", "client_secret"] {
            assert!(is_secret_setting(k), "{k}");
        }
        for k in ["theme", "download_dir", "global_speed_limit", "bandwidth_policy", "resume_on_start"] {
            assert!(!is_secret_setting(k), "{k}");
        }
    }

    fn sample_record(id: &str) -> DownloadRecord {
        serde_json::from_value(serde_json::json!({
            "id": id, "url": "https://example.com/a.zip", "saveDir": "C:/x", "fileName": "a.zip",
            "connections": 4, "state": "completed", "createdAt": 5,
            "http": { "username": "alice", "password": "hunter2", "cookies": "sid=secret", "headers": [["Authorization", "Bearer abc"]] }
        }))
        .unwrap()
    }

    #[tokio::test]
    async fn a_backup_restores_settings_and_history_on_another_install_without_secrets() {
        // PC 1
        let d1 = tempfile::tempdir().unwrap();
        let db1 = Db::open(&d1.path().join("a.db"), d1.path()).await.unwrap();
        let (tx1, _rx1) = tokio::sync::mpsc::unbounded_channel();
        let engine1 = Engine::new(flowget_engine::EngineConfig::new(d1.path().to_path_buf()), tx1);
        db1.set_setting("theme", "light").await.unwrap();
        db1.set_setting("license_key", "SECRET-LICENSE").await.unwrap();
        engine1.restore(vec![sample_record("dl-1")]);

        let backup = build_backup(&db1, &engine1).await.unwrap();
        let json = serde_json::to_string(&backup).unwrap();
        for secret in ["hunter2", "sid=secret", "Bearer abc", "SECRET-LICENSE"] {
            assert!(!json.contains(secret), "{secret} leaked into the backup");
        }
        assert!(json.contains("alice") && json.contains("\"theme\""));

        // PC 2
        let d2 = tempfile::tempdir().unwrap();
        let db2 = Db::open(&d2.path().join("b.db"), d2.path()).await.unwrap();
        let (tx2, _rx2) = tokio::sync::mpsc::unbounded_channel();
        let engine2 = Engine::new(flowget_engine::EngineConfig::new(d2.path().to_path_buf()), tx2);
        let summary = restore_backup(&db2, &engine2, parse_backup(&json).unwrap()).await.unwrap();
        assert_eq!((summary.downloads, summary.skipped_downloads), (1, 0));
        assert_eq!(db2.get_setting("theme").await.as_deref(), Some("light"));
        assert_eq!(db2.get_setting("license_key").await, None);
        assert_eq!(engine2.list().len(), 1);
        assert_eq!(db2.load_downloads().await.unwrap().len(), 1, "the history is saved, not only shown");

        // Restoring the same file again changes nothing.
        let again = restore_backup(&db2, &engine2, parse_backup(&json).unwrap()).await.unwrap();
        assert_eq!((again.downloads, again.skipped_downloads), (0, 1));
        assert_eq!(engine2.list().len(), 1);
    }

    #[test]
    fn backup_files_are_checked_before_use() {
        assert!(parse_backup("not json").is_err());
        assert!(parse_backup(r#"{"app":"Other","format":1}"#).is_err());
        assert!(parse_backup(r#"{"app":"FlowGet","format":99}"#).unwrap_err().contains("newer"));
        let ok = parse_backup(r#"{"app":"FlowGet","format":1,"settings":{"theme":"dark"}}"#).unwrap();
        assert_eq!(ok.settings.get("theme").map(String::as_str), Some("dark"));
    }
}
