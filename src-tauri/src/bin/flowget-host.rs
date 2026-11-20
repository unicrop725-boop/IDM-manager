//! FlowGet Native Messaging Host executable.
//! Connects browser extensions (Chrome, Edge, Brave, Firefox) via stdio to FlowGet desktop app.

use std::io::{self, Read, Write};
use std::process::Command;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();

    // Check if called with --register flag
    if args.iter().any(|a| a == "--register") {
        return register_for_all_browsers();
    }

    // Native Messaging loop
    let mut stdin = io::stdin().lock();
    let mut stdout = io::stdout().lock();

    loop {
        // Read 4-byte little-endian message length
        let mut len_buf = [0u8; 4];
        if stdin.read_exact(&mut len_buf).is_err() {
            break; // EOF or browser disconnected
        }
        let msg_len = u32::from_ne_bytes(len_buf) as usize;
        if msg_len == 0 || msg_len > 10 * 1024 * 1024 {
            break; // Guard against invalid length
        }

        let mut msg_buf = vec![0u8; msg_len];
        if stdin.read_exact(&mut msg_buf).is_err() {
            break;
        }

        // Forward to local loopback HTTP endpoint
        let response_json = match forward_to_app(&msg_buf) {
            Ok(resp) => resp,
            Err(e) => format!(r#"{{"ok":false,"error":"{}"}}"#, e),
        };

        // Write 4-byte length prefix + response to stdout
        let resp_bytes = response_json.as_bytes();
        let resp_len = (resp_bytes.len() as u32).to_ne_bytes();
        let _ = stdout.write_all(&resp_len);
        let _ = stdout.write_all(resp_bytes);
        let _ = stdout.flush();
    }

    Ok(())
}

fn forward_to_app(payload_bytes: &[u8]) -> Result<String, Box<dyn std::error::Error>> {
    // Synchronous lightweight HTTP POST to 127.0.0.1:21588
    use std::io::Write as _;
    use std::net::TcpStream;

    let mut stream = TcpStream::connect("127.0.0.1:21588")?;
    let req = format!(
        "POST /api/download HTTP/1.1\r\nHost: 127.0.0.1:21588\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        payload_bytes.len()
    );

    stream.write_all(req.as_bytes())?;
    stream.write_all(payload_bytes)?;

    let mut response = Vec::new();
    stream.read_to_end(&mut response)?;

    let response_str = String::from_utf8_lossy(&response);
    if let Some(body_start) = response_str.find("\r\n\r\n") {
        Ok(response_str[body_start + 4..].to_string())
    } else {
        Ok(r#"{"ok":true}"#.to_string())
    }
}

fn register_for_all_browsers() -> Result<(), Box<dyn std::error::Error>> {
    println!("============================================================");
    println!("  REGISTERING FLOWGET NATIVE MESSAGING HOST FOR ALL BROWSERS ");
    println!("============================================================");

    let current_exe = std::env::current_exe()?;
    let exe_dir = current_exe.parent().ok_or("Cannot find parent directory")?;
    let manifest_path = exe_dir.join("com.flowget.app.json");

    let manifest_content = format!(
        r#"{{
  "name": "com.flowget.app",
  "description": "FlowGet Download Manager Native Messaging Host",
  "path": "{}",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://*/"
  ]
}}"#,
        current_exe.to_string_lossy().replace('\\', "\\\\")
    );

    std::fs::write(&manifest_path, manifest_content)?;
    println!("[1/5] Generated native host manifest at: {:?}", manifest_path);

    let manifest_str = manifest_path.to_string_lossy();

    // Registry paths for Chrome, Edge, Brave, Firefox
    let browser_keys = [
        ("Google Chrome", r#"HKCU\Software\Google\Chrome\NativeMessagingHosts\com.flowget.app"#),
        ("Microsoft Edge", r#"HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.flowget.app"#),
        ("Brave Browser", r#"HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.flowget.app"#),
        ("Mozilla Firefox", r#"HKCU\Software\Mozilla\NativeMessagingHosts\com.flowget.app"#),
    ];

    for (name, reg_key) in browser_keys {
        let status = Command::new("reg.exe")
            .args(["add", reg_key, "/ve", "/t", "REG_SZ", "/d", &manifest_str, "/f"])
            .status();

        match status {
            Ok(s) if s.success() => println!("  [OK] Registered for {name}: {reg_key}"),
            _ => println!("  [SKIP/NOTE] Could not register key {reg_key}"),
        }
    }

    println!("[PASS] FlowGet Native Messaging Host registration completed!");
    Ok(())
}
