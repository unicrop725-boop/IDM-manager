//! System-wide clipboard watcher (like IDM): when a downloadable link is copied anywhere -- a
//! browser, a chat, a document -- the app is told so it can offer to download it.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

const POLL: Duration = Duration::from_millis(700);

/// File types that are worth offering to download.
const EXTENSIONS: &[&str] = &[
    "zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso", "img", "exe", "msi", "dmg", "pkg", "deb", "rpm", "apk",
    "ipa", "bin", "torrent", "mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "m4v", "mp3", "flac", "wav", "m4a",
    "aac", "ogg", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "epub", "m3u8", "mpd",
];

#[derive(Clone, Serialize)]
pub struct ClipboardUrl {
    pub url: String,
    /// "video" for video-page sites (YouTube, ...), "file" for direct files, "magnet" for torrents.
    pub kind: &'static str,
}

/// Decide whether copied text is a link the app should offer to download.
pub fn classify(text: &str) -> Option<ClipboardUrl> {
    let t = text.trim();
    if t.is_empty() || t.len() > 2048 || t.chars().any(|c| c.is_whitespace()) {
        return None;
    }
    if t.to_ascii_lowercase().starts_with("magnet:?") && t.contains("xt=urn:btih:") {
        return Some(ClipboardUrl { url: t.to_string(), kind: "magnet" });
    }
    let url = url::Url::parse(t).ok()?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return None;
    }
    url.host_str()?;

    if crate::media_stream::is_video_page_url(t) {
        // a real video link, not just the site's front page
        let has_path = url.path().trim_matches('/').len() > 1;
        let has_id = url.query_pairs().any(|(k, _)| k == "v" || k == "list");
        if has_path || has_id {
            return Some(ClipboardUrl { url: t.to_string(), kind: "video" });
        }
        return None;
    }

    let last = url.path_segments()?.next_back().unwrap_or("").to_ascii_lowercase();
    let ext = last.rsplit_once('.').map(|(_, e)| e.to_string())?;
    if EXTENSIONS.contains(&ext.as_str()) {
        return Some(ClipboardUrl { url: t.to_string(), kind: "file" });
    }
    None
}

/// Poll the clipboard until `stop` is set; call `on_link` for every newly copied downloadable link.
/// The text already on the clipboard when the watcher starts is ignored.
pub fn watch_loop(stop: &AtomicBool, enabled: impl Fn() -> bool, mut on_link: impl FnMut(ClipboardUrl)) {
    let mut clipboard = match arboard::Clipboard::new() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[clipboard] watcher not available: {e}");
            return;
        }
    };
    let mut last: Option<String> = clipboard.get_text().ok();
    while !stop.load(Ordering::SeqCst) {
        std::thread::sleep(POLL);
        let Ok(text) = clipboard.get_text() else { continue };
        if last.as_deref() == Some(text.as_str()) {
            continue;
        }
        last = Some(text.clone());
        if !enabled() {
            continue;
        }
        if let Some(link) = classify(&text) {
            on_link(link);
        }
    }
}

/// Start the watcher on its own thread. It tells the UI, and brings the window forward if the app
/// is in the background so the prompt is seen.
pub fn start(app: AppHandle, db: crate::db::Db) {
    std::thread::spawn(move || {
        let stop = AtomicBool::new(false);
        let db_enabled = db.clone();
        watch_loop(
            &stop,
            move || tauri::async_runtime::block_on(db_enabled.get_setting("clipboard_monitor")).as_deref() != Some("0"),
            |link| {
                let window = app.get_webview_window("main");
                // copying inside the app itself should not trigger a prompt
                if window.as_ref().and_then(|w| w.is_focused().ok()).unwrap_or(false) {
                    return;
                }
                if let Some(w) = &window {
                    let _ = w.show();
                    let _ = w.unminimize();
                    // come to the front without waiting for focus permission
                    let _ = w.set_always_on_top(true);
                    let _ = w.set_always_on_top(false);
                    let _ = w.request_user_attention(Some(tauri::UserAttentionType::Informational));
                }
                let _ = app.emit("clipboard-url", link);
            },
        );
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kind(s: &str) -> Option<&'static str> {
        classify(s).map(|c| c.kind)
    }

    #[test]
    fn recognises_files_videos_and_magnets() {
        assert_eq!(kind("https://example.com/files/setup.exe"), Some("file"));
        assert_eq!(kind("  https://example.com/a/b/Movie.MKV?token=1  "), Some("file"));
        assert_eq!(kind("https://youtu.be/6PVKNZCpex8"), Some("video"));
        assert_eq!(kind("https://www.youtube.com/watch?v=abc123"), Some("video"));
        assert_eq!(kind("https://vimeo.com/123456"), Some("video"));
        assert_eq!(kind("magnet:?xt=urn:btih:ABCDEF0123&dn=x"), Some("magnet"));
    }

    #[test]
    fn ignores_everything_else() {
        assert_eq!(kind("hello world"), None);
        assert_eq!(kind(""), None);
        assert_eq!(kind("https://example.com/"), None);
        assert_eq!(kind("https://example.com/page.html"), None);
        assert_eq!(kind("https://www.youtube.com/"), None);
        assert_eq!(kind("ftp://example.com/a.zip"), None);
        assert_eq!(kind("see https://example.com/a.zip please"), None);
        assert_eq!(kind("file:///C:/Windows/a.zip"), None);
        assert_eq!(kind(&format!("https://example.com/{}.zip", "a".repeat(3000))), None);
    }

    /// Needs a real clipboard: copies links with PowerShell and checks the watcher sees them.
    /// `cargo test --lib live_clipboard -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_clipboard_watcher_sees_copied_links() {
        use std::sync::{Arc, Mutex};
        let set = |text: &str| {
            let ok = std::process::Command::new("powershell")
                .args(["-NoProfile", "-Command", &format!("Set-Clipboard -Value '{text}'")])
                .status()
                .unwrap()
                .success();
            assert!(ok);
        };
        let original = arboard::Clipboard::new().unwrap().get_text().ok();

        let stop = Arc::new(AtomicBool::new(false));
        let seen = Arc::new(Mutex::new(Vec::<String>::new()));
        let (stop2, seen2) = (stop.clone(), seen.clone());
        let handle = std::thread::spawn(move || {
            watch_loop(&stop2, || true, |l| seen2.lock().unwrap().push(format!("{}:{}", l.kind, l.url)));
        });

        std::thread::sleep(Duration::from_millis(1200));
        set("just some text, not a link");
        std::thread::sleep(Duration::from_millis(1200));
        set("https://example.com/tool.zip");
        std::thread::sleep(Duration::from_millis(1500));
        set("https://youtu.be/6PVKNZCpex8");
        std::thread::sleep(Duration::from_millis(1500));

        stop.store(true, Ordering::SeqCst);
        handle.join().unwrap();
        if let Some(o) = original {
            let _ = arboard::Clipboard::new().unwrap().set_text(o);
        }
        let seen = seen.lock().unwrap().clone();
        println!("watcher saw: {seen:?}");
        assert_eq!(seen, vec!["file:https://example.com/tool.zip".to_string(), "video:https://youtu.be/6PVKNZCpex8".to_string()]);
    }
}
