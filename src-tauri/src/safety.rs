//! Safety checks for finished downloads: warnings about risky file names (programs, double extensions) and an
//! optional VirusTotal lookup by SHA-256. Only the hash leaves the PC, never the file.

use std::path::Path;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::db::Db;

/// Target name of the API key in the Windows Credential Manager (see `vault`).
pub const VT_KEY_ID: &str = "virustotal-api-key";
/// The free VirusTotal API allows 4 lookups a minute.
const VT_MIN_GAP: Duration = Duration::from_secs(16);
/// SHA-256 of the harmless EICAR test file: VirusTotal knows it, so a lookup proves the key works.
const EICAR_SHA256: &str = "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Warning {
    /// executable | double_extension | hidden_extension | reversed_name
    pub code: String,
    /// high | medium
    pub severity: String,
    pub message: String,
}

const PROGRAM_EXTS: &[&str] = &[
    "exe", "msi", "bat", "cmd", "com", "scr", "pif", "vbs", "vbe", "js", "jse", "wsf", "wsh", "ps1", "psm1", "jar", "hta",
    "reg", "lnk", "cpl", "msc", "appx", "msix", "msp", "dll",
];
/// Extensions people expect to be safe to open; a program dressed up as one of these is the classic trick.
const DECOY_EXTS: &[&str] = &[
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "csv", "jpg", "jpeg", "png", "gif", "bmp", "mp3", "mp4",
    "mkv", "avi", "mov", "zip", "rar", "7z", "html", "htm",
];

fn warning(code: &str, severity: &str, message: impl Into<String>) -> Warning {
    Warning { code: code.into(), severity: severity.into(), message: message.into() }
}

/// Warnings for a file name, most serious first. Empty = nothing suspicious.
pub fn assess_name(file_name: &str) -> Vec<Warning> {
    let mut out = Vec::new();
    // A right-to-left override makes "invoice\u{202E}fdp.exe" display as "invoiceexe.pdf".
    if file_name.contains('\u{202E}') || file_name.contains('\u{202D}') {
        out.push(warning(
            "reversed_name",
            "high",
            "The file name contains hidden text-direction characters, a trick used to disguise programs. Do not open it.",
        ));
    }
    // Spaces or dots before the real extension push it out of sight ("report.pdf      .exe").
    let name = file_name.trim().trim_end_matches(['.', ' ']);
    let parts: Vec<&str> = name.split('.').collect();
    let ext = if parts.len() > 1 { parts[parts.len() - 1].trim().to_ascii_lowercase() } else { String::new() };
    let is_program = PROGRAM_EXTS.contains(&ext.as_str());

    if is_program && parts.len() >= 3 {
        let inner = parts[parts.len() - 2].trim().to_ascii_lowercase();
        if DECOY_EXTS.contains(&inner.as_str()) {
            out.insert(
                0,
                warning(
                    "double_extension",
                    "high",
                    format!(
                        "\"{file_name}\" looks like a .{inner} file but is really a .{ext} program. This is a common way to spread malware. Do not open it unless you are certain."
                    ),
                ),
            );
        }
    }
    if is_program && parts.len() >= 2 && parts[parts.len() - 2].ends_with(' ') {
        out.push(warning(
            "hidden_extension",
            "high",
            "The name has extra spaces before its real ending, which hides that this is a program.",
        ));
    }
    if is_program && !out.iter().any(|w| w.code == "double_extension") {
        let what = match ext.as_str() {
            "exe" | "msi" | "msix" | "appx" | "msp" => "an installer or program",
            "bat" | "cmd" | "ps1" | "psm1" | "vbs" | "vbe" | "js" | "jse" | "wsf" | "wsh" | "hta" | "reg" => "a script",
            "lnk" => "a shortcut",
            "scr" => "a screen saver, which is really a program",
            "jar" => "a Java program",
            _ => "a program file",
        };
        out.push(warning(
            "executable",
            "medium",
            format!("This is {what} (.{ext}). It can change your PC. Only run it if you trust where it came from."),
        ));
    }
    out
}

// ---------------------------------------------------------------------------------------------------------------
// VirusTotal

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct VtResult {
    /// clean | suspicious | flagged | unknown | limit | error
    pub status: String,
    pub malicious: u32,
    pub suspicious: u32,
    pub harmless: u32,
    pub undetected: u32,
    /// Engines that gave an opinion.
    pub total: u32,
    pub link: String,
    pub message: Option<String>,
}

/// Read VirusTotal's answer to `GET /api/v3/files/{sha256}`.
pub fn parse_vt_response(http_status: u16, body: &str, sha256: &str) -> VtResult {
    let link = format!("https://www.virustotal.com/gui/file/{sha256}");
    let mk = |status: &str, message: &str| VtResult {
        status: status.into(),
        link: link.clone(),
        message: Some(message.into()),
        ..Default::default()
    };
    match http_status {
        200 => {
            let v: serde_json::Value = match serde_json::from_str(body) {
                Ok(v) => v,
                Err(_) => return mk("error", "VirusTotal sent an answer that could not be read."),
            };
            let stats = &v["data"]["attributes"]["last_analysis_stats"];
            let n = |k: &str| stats[k].as_u64().unwrap_or(0) as u32;
            let (malicious, suspicious, harmless, undetected) = (n("malicious"), n("suspicious"), n("harmless"), n("undetected"));
            let total = malicious + suspicious + harmless + undetected;
            if total == 0 {
                return mk("unknown", "VirusTotal has not finished scanning this file yet.");
            }
            // One or two engines out of ~70 is often a false alarm; three or more is a real warning.
            let status = if malicious >= 3 {
                "flagged"
            } else if malicious >= 1 || suspicious >= 1 {
                "suspicious"
            } else {
                "clean"
            };
            VtResult { status: status.into(), malicious, suspicious, harmless, undetected, total, link, message: None }
        }
        404 => mk("unknown", "VirusTotal has never seen this exact file. That is normal for new or rare files."),
        401 | 403 => mk("error", "VirusTotal did not accept the API key. Check it in Options > Safety."),
        429 => mk("limit", "VirusTotal's free limit was reached. It will be tried again later."),
        other => mk("error", &format!("VirusTotal answered with error {other}.")),
    }
}

fn limiter() -> &'static tokio::sync::Mutex<Option<Instant>> {
    static L: OnceLock<tokio::sync::Mutex<Option<Instant>>> = OnceLock::new();
    L.get_or_init(|| tokio::sync::Mutex::new(None))
}

/// Ask VirusTotal about a hash, keeping to the free plan's rate limit.
pub async fn vt_lookup(sha256: &str, key: &str) -> VtResult {
    {
        let mut last = limiter().lock().await;
        if let Some(t) = *last {
            let since = t.elapsed();
            if since < VT_MIN_GAP {
                tokio::time::sleep(VT_MIN_GAP - since).await;
            }
        }
        *last = Some(Instant::now());
    }
    let client = match reqwest::Client::builder().user_agent("BoltGrab").timeout(Duration::from_secs(25)).build() {
        Ok(c) => c,
        Err(e) => return parse_vt_response(0, &e.to_string(), sha256),
    };
    match client.get(format!("https://www.virustotal.com/api/v3/files/{sha256}")).header("x-apikey", key).send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            parse_vt_response(status, &body, sha256)
        }
        Err(_) => VtResult {
            status: "error".into(),
            link: format!("https://www.virustotal.com/gui/file/{sha256}"),
            message: Some("Could not reach VirusTotal. Check your internet connection.".into()),
            ..Default::default()
        },
    }
}

/// Is this API key accepted? (Looks up the EICAR test file.)
pub async fn check_key(key: &str) -> Result<(), String> {
    let r = vt_lookup(EICAR_SHA256, key).await;
    match r.status.as_str() {
        "error" | "limit" => Err(r.message.unwrap_or_else(|| "VirusTotal did not accept the key.".into())),
        _ => Ok(()),
    }
}

pub fn sha256_file(path: &Path) -> std::io::Result<String> {
    use std::io::Read;
    let mut f = std::fs::File::open(path)?;
    let mut ctx = ring::digest::Context::new(&ring::digest::SHA256);
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        ctx.update(&buf[..n]);
    }
    Ok(ctx.finish().as_ref().iter().map(|b| format!("{b:02x}")).collect())
}

// ---------------------------------------------------------------------------------------------------------------
// Reports

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SafetyReport {
    pub id: String,
    pub file_name: String,
    pub warnings: Vec<Warning>,
    pub sha256: Option<String>,
    pub vt: Option<VtResult>,
    pub checked_at: i64,
}

impl SafetyReport {
    /// Anything the user should see before opening the file.
    pub fn is_risky(&self) -> bool {
        self.warnings.iter().any(|w| w.severity == "high")
            || self.vt.as_ref().is_some_and(|v| v.status == "flagged" || v.status == "suspicious")
    }
}

async fn publish(app: &AppHandle, db: &Db, report: &SafetyReport) {
    if let Err(e) = db.save_safety(report).await {
        eprintln!("[safety] could not save the report for {}: {e}", report.id);
    }
    let _ = app.emit("safety-updated", report);
}

/// Check a finished download: file-name warnings at once, then the VirusTotal lookup if it is switched on.
pub async fn on_completed(app: AppHandle, db: Db, id: String, file_name: String, file_path: String) {
    let vt_on = db.get_setting("virustotal_enabled").await.as_deref() == Some("1");
    let key = if vt_on { crate::vault::load(VT_KEY_ID).filter(|k| !k.trim().is_empty()) } else { None };

    let existing = db.load_safety().await.unwrap_or_default().into_iter().find(|r| r.id == id);
    if let Some(r) = &existing {
        // Already checked (this event also fires when the list entry is edited later).
        if r.vt.as_ref().is_some_and(|v| v.status != "limit" && v.status != "error") || key.is_none() {
            return;
        }
    }

    let mut report = existing.unwrap_or_else(|| SafetyReport {
        id: id.clone(),
        file_name: file_name.clone(),
        warnings: assess_name(&file_name),
        checked_at: chrono::Utc::now().timestamp(),
        ..Default::default()
    });
    publish(&app, &db, &report).await;

    let Some(key) = key else { return };
    let path = file_path.clone();
    let hash = tokio::task::spawn_blocking(move || sha256_file(Path::new(&path))).await;
    let Ok(Ok(hash)) = hash else { return };
    report.sha256 = Some(hash.clone());
    report.vt = Some(vt_lookup(&hash, &key).await);
    report.checked_at = chrono::Utc::now().timestamp();
    publish(&app, &db, &report).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn codes(name: &str) -> Vec<String> {
        assess_name(name).into_iter().map(|w| w.code).collect()
    }

    #[test]
    fn programs_get_a_medium_warning() {
        for n in ["setup.exe", "Installer.MSI", "run.bat", "a.ps1", "x.scr", "tool.jar"] {
            let w = assess_name(n);
            assert_eq!(w.len(), 1, "{n}: {w:?}");
            assert_eq!((w[0].code.as_str(), w[0].severity.as_str()), ("executable", "medium"), "{n}");
        }
    }

    #[test]
    fn a_program_pretending_to_be_a_document_is_a_high_warning() {
        for n in ["invoice.pdf.exe", "Photo.JPG.scr", "report.docx.bat", "song.mp3.exe", "movie.mp4.vbs"] {
            let w = assess_name(n);
            assert_eq!(w[0].code, "double_extension", "{n}: {w:?}");
            assert_eq!(w[0].severity, "high");
        }
        // The extra spaces trick.
        assert!(codes("report.pdf      .exe").contains(&"hidden_extension".to_string()));
        // Direction override.
        assert!(codes("invoice\u{202E}fdp.exe").contains(&"reversed_name".to_string()));
    }

    #[test]
    fn ordinary_files_are_not_flagged() {
        for n in ["photo.jpg", "holiday.mp4", "archive.zip", "report.pdf", "notes.txt", "my.file.name.pdf", "v1.2.3.zip", "README", "data.tar.gz"] {
            assert!(assess_name(n).is_empty(), "{n} should be fine");
        }
        // A program with dots in its name is a program, not a disguise.
        let w = assess_name("setup.v2.exe");
        assert_eq!(w.len(), 1);
        assert_eq!(w[0].code, "executable");
    }

    #[test]
    fn virustotal_answers_are_read_correctly() {
        let h = "ab".repeat(32);
        let body = |m: u32, s: u32, h_: u32, u: u32| {
            format!(r#"{{"data":{{"attributes":{{"last_analysis_stats":{{"malicious":{m},"suspicious":{s},"harmless":{h_},"undetected":{u},"timeout":2}}}}}}}}"#)
        };
        let clean = parse_vt_response(200, &body(0, 0, 60, 10), &h);
        assert_eq!((clean.status.as_str(), clean.total), ("clean", 70));
        let few = parse_vt_response(200, &body(2, 0, 50, 18), &h);
        assert_eq!(few.status, "suspicious", "one or two detections are not proof");
        let bad = parse_vt_response(200, &body(31, 2, 20, 17), &h);
        assert_eq!((bad.status.as_str(), bad.malicious), ("flagged", 31));
        assert!(bad.link.ends_with(&h));
        assert_eq!(parse_vt_response(404, "{}", &h).status, "unknown");
        assert_eq!(parse_vt_response(401, "{}", &h).status, "error");
        assert_eq!(parse_vt_response(429, "{}", &h).status, "limit");
        assert_eq!(parse_vt_response(200, "<html>", &h).status, "error");
        assert_eq!(parse_vt_response(200, &body(0, 0, 0, 0), &h).status, "unknown", "no engine has answered yet");
    }

    #[test]
    fn a_report_is_risky_for_a_disguised_program_or_a_detected_file() {
        let mut r = SafetyReport { warnings: assess_name("setup.exe"), ..Default::default() };
        assert!(!r.is_risky(), "a plain installer only gets the gentle warning");
        r.warnings = assess_name("invoice.pdf.exe");
        assert!(r.is_risky());
        let r2 = SafetyReport { vt: Some(VtResult { status: "flagged".into(), ..Default::default() }), ..Default::default() };
        assert!(r2.is_risky());
    }

    #[test]
    fn the_file_hash_is_the_real_sha256() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("a.txt");
        std::fs::write(&f, b"abc").unwrap();
        assert_eq!(sha256_file(&f).unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }
}
