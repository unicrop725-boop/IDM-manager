//! BoltGrab Native Messaging Host executable.
//! Connects browser extensions (Chrome, Edge, Brave, Firefox) via stdio to the BoltGrab desktop app.
//!
//! Security notes
//! * The browser only starts this program for the extension IDs listed in the host manifest
//!   (`allowed_origins` for Chromium browsers, `allowed_extensions` for Firefox). Wildcards are not
//!   valid there, so `--register` refuses to run without explicit IDs.
//! * Every message is checked (JSON object, allowed URL scheme, field types and sizes) before it is
//!   forwarded to the app, and the app validates it again.

use std::io::{self, Read, Write};
use std::process::Command;
use std::time::Duration;

#[path = "../payload_check.rs"]
mod payload_check;

/// Messages from the extension are small (a URL, headers, a cookie string).
const MAX_MESSAGE_BYTES: usize = 1024 * 1024;
/// The app's answer is a few dozen bytes; never buffer more than this.
const MAX_RESPONSE_BYTES: u64 = 64 * 1024;
const APP_ADDR: &str = "127.0.0.1:21588";

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();

    if args.iter().any(|a| a == "--register") {
        return register_for_all_browsers(&args);
    }

    let mut stdin = io::stdin().lock();
    let mut stdout = io::stdout().lock();

    loop {
        // 4-byte message length in native byte order (little-endian on Windows).
        let mut len_buf = [0u8; 4];
        if stdin.read_exact(&mut len_buf).is_err() {
            break; // EOF or browser disconnected
        }
        let msg_len = u32::from_ne_bytes(len_buf) as usize;
        if msg_len == 0 || msg_len > MAX_MESSAGE_BYTES {
            break; // Invalid length: stop rather than try to resynchronise.
        }

        let mut msg_buf = vec![0u8; msg_len];
        if stdin.read_exact(&mut msg_buf).is_err() {
            break;
        }

        let response_json = match handle_message(&msg_buf) {
            Ok(resp) => resp,
            Err(e) => error_json(&e),
        };

        let resp_bytes = response_json.as_bytes();
        let resp_len = (resp_bytes.len() as u32).to_ne_bytes();
        let _ = stdout.write_all(&resp_len);
        let _ = stdout.write_all(resp_bytes);
        let _ = stdout.flush();
    }

    Ok(())
}

/// `{"ok":false,"error":...}` built with a JSON serializer (the old code pasted the error text into
/// a string, so a quote in it produced broken JSON).
fn error_json(msg: &str) -> String {
    serde_json::json!({ "ok": false, "error": msg }).to_string()
}

/// Validate a message and forward it to the app.
fn handle_message(bytes: &[u8]) -> Result<String, String> {
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|_| "message is not valid JSON".to_string())?;
    payload_check::validate_download_payload(&value)?;
    // Re-serialise what we validated instead of forwarding the raw bytes.
    let body = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
    forward_to_app(&body).map_err(|e| format!("BoltGrab is not running or not reachable ({e})"))
}

/// Start the BoltGrab app (it sits next to this executable) and wait until it accepts connections.
fn launch_app_and_wait(addr: &std::net::SocketAddr) -> Result<(), Box<dyn std::error::Error>> {
    use std::net::TcpStream;

    let exe = std::env::current_exe()?;
    let app = exe.parent().ok_or("no parent directory")?.join(if cfg!(windows) { "BoltGrab.exe" } else { "boltgrab" });
    if !app.is_file() {
        return Err("BoltGrab is not running and its program was not found next to the native host".into());
    }
    Command::new(&app).spawn()?;
    // Starting the window and the local server takes a few seconds.
    for _ in 0..60 {
        std::thread::sleep(Duration::from_millis(500));
        if TcpStream::connect_timeout(addr, Duration::from_millis(400)).is_ok() {
            return Ok(());
        }
    }
    Err("BoltGrab did not start in time".into())
}

fn forward_to_app(payload: &[u8]) -> Result<String, Box<dyn std::error::Error>> {
    use std::net::{SocketAddr, TcpStream};

    let addr: SocketAddr = APP_ADDR.parse()?;
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_secs(3)) {
        Ok(s) => s,
        Err(_) => {
            // The app is closed: open it, then deliver the download.
            launch_app_and_wait(&addr)?;
            TcpStream::connect_timeout(&addr, Duration::from_secs(3))?
        }
    };
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    stream.set_write_timeout(Some(Duration::from_secs(10)))?;

    let req = format!(
        "POST /api/download HTTP/1.1\r\nHost: {APP_ADDR}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        payload.len()
    );
    stream.write_all(req.as_bytes())?;
    stream.write_all(payload)?;

    let mut response = Vec::new();
    stream.take(MAX_RESPONSE_BYTES).read_to_end(&mut response)?;

    let response_str = String::from_utf8_lossy(&response);
    let status_ok = response_str.starts_with("HTTP/1.1 200");
    match response_str.find("\r\n\r\n") {
        Some(i) if status_ok => Ok(response_str[i + 4..].to_string()),
        Some(i) => Err(format!("app refused the request: {}", response_str[i + 4..].trim()).into()),
        None => Err("malformed response from app".into()),
    }
}

/// Chromium extension IDs are 32 characters, a-p.
fn valid_chromium_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| (b'a'..=b'p').contains(&b))
}

/// Firefox add-on IDs look like `name@domain` or `{uuid}`.
fn valid_firefox_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id != "*"
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b"@._-{}".contains(&b))
}

fn arg_value(args: &[String], flag: &str) -> Option<String> {
    args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).cloned()
}

fn chromium_manifest(exe: &str, extension_id: &str) -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "name": "com.flowget.app",
        "description": "BoltGrab Download Manager Native Messaging Host",
        "path": exe,
        "type": "stdio",
        "allowed_origins": [format!("chrome-extension://{extension_id}/")],
    }))
    .unwrap()
}

fn firefox_manifest(exe: &str, addon_id: &str) -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "name": "com.flowget.app",
        "description": "BoltGrab Download Manager Native Messaging Host",
        "path": exe,
        "type": "stdio",
        "allowed_extensions": [addon_id],
    }))
    .unwrap()
}

fn register_for_all_browsers(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let chromium_id = arg_value(args, "--extension-id");
    let firefox_id = arg_value(args, "--firefox-id");

    if chromium_id.is_none() && firefox_id.is_none() {
        return Err("usage: flowget-host --register --extension-id <32-letter Chrome/Edge/Brave extension ID> [--firefox-id <add-on ID>]\n\
                    Browsers only accept explicit IDs here (no wildcards), so at least one is required. \
                    Find the ID on chrome://extensions with Developer mode on."
            .into());
    }
    if let Some(id) = &chromium_id {
        if !valid_chromium_id(id) {
            return Err(format!("'{id}' is not a valid Chrome/Edge/Brave extension ID (32 characters a-p)").into());
        }
    }
    if let Some(id) = &firefox_id {
        if !valid_firefox_id(id) {
            return Err(format!("'{id}' is not a valid Firefox add-on ID").into());
        }
    }

    let current_exe = std::env::current_exe()?;
    let exe_dir = current_exe.parent().ok_or("Cannot find parent directory")?;
    let exe = current_exe.to_string_lossy().to_string();

    println!("Registering the BoltGrab native messaging host");
    let mut targets: Vec<(&str, &str, std::path::PathBuf)> = Vec::new();

    if let Some(id) = &chromium_id {
        let path = exe_dir.join("com.flowget.app.json");
        std::fs::write(&path, chromium_manifest(&exe, id))?;
        for (name, key) in [
            ("Google Chrome", r"HKCU\Software\Google\Chrome\NativeMessagingHosts\com.flowget.app"),
            ("Microsoft Edge", r"HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.flowget.app"),
            ("Brave Browser", r"HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.flowget.app"),
        ] {
            targets.push((name, key, path.clone()));
        }
    }
    if let Some(id) = &firefox_id {
        let path = exe_dir.join("com.flowget.app.firefox.json");
        std::fs::write(&path, firefox_manifest(&exe, id))?;
        targets.push(("Mozilla Firefox", r"HKCU\Software\Mozilla\NativeMessagingHosts\com.flowget.app", path));
    }

    for (name, key, manifest) in targets {
        let status = Command::new("reg.exe")
            .args(["add", key, "/ve", "/t", "REG_SZ", "/d"])
            .arg(&manifest)
            .args(["/f"])
            .status();
        match status {
            Ok(s) if s.success() => println!("  [OK] {name}"),
            _ => println!("  [FAILED] {name}: could not write {key}"),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_validation() {
        assert!(valid_chromium_id("abcdefghijklmnopabcdefghijklmnop"));
        assert!(!valid_chromium_id("*"));
        assert!(!valid_chromium_id("abcdefghijklmnopabcdefghijklmnoq")); // q is outside a-p
        assert!(!valid_chromium_id("short"));
        assert!(valid_firefox_id("flowget@example.com"));
        assert!(!valid_firefox_id("*"));
        assert!(!valid_firefox_id("a\"b"));
    }

    #[test]
    fn manifests_have_no_wildcards_and_are_valid_json() {
        let m: serde_json::Value = serde_json::from_str(&chromium_manifest(
            r"C:\Program Files\BoltGrab\flowget-host.exe",
            "abcdefghijklmnopabcdefghijklmnop",
        ))
        .unwrap();
        assert_eq!(m["allowed_origins"][0], "chrome-extension://abcdefghijklmnopabcdefghijklmnop/");
        assert_eq!(m["path"], r"C:\Program Files\BoltGrab\flowget-host.exe");
        let f: serde_json::Value = serde_json::from_str(&firefox_manifest("x.exe", "flowget@example.com")).unwrap();
        assert_eq!(f["allowed_extensions"][0], "flowget@example.com");
        assert!(f.get("allowed_origins").is_none());
    }

    #[test]
    fn error_json_is_always_valid_json() {
        let j = error_json("a \"quoted\" \\ message\n");
        let v: serde_json::Value = serde_json::from_str(&j).unwrap();
        assert_eq!(v["ok"], false);
    }

    #[test]
    fn bad_messages_are_rejected_before_forwarding() {
        assert!(handle_message(b"not json").is_err());
        assert!(handle_message(br#"{"url":"file:///C:/x"}"#).is_err());
        assert!(handle_message(br#"{"url":"--exec=calc"}"#).is_err());
        assert!(handle_message(br#"[1]"#).is_err());
    }
}
