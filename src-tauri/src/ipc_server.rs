//! Local loopback IPC server connecting browser extensions and native host to FlowGet.

use std::net::SocketAddr;
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDownloadPayload {
    pub action: Option<String>,
    pub url: String,
    pub file_name: Option<String>,
    pub save_dir: Option<String>,
    pub cookies: Option<String>,
    pub referer: Option<String>,
    pub user_agent: Option<String>,
    pub mime: Option<String>,
    pub total_size: Option<u64>,
}

pub struct IpcServer {
    app_handle: Option<AppHandle>,
}

impl IpcServer {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            app_handle: Some(app_handle),
        }
    }

    pub fn new_test() -> Self {
        Self { app_handle: None }
    }

    /// Run the local loopback TCP listener on port 21588
    pub async fn run(self: Arc<Self>, port: u16) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let addr: SocketAddr = format!("127.0.0.1:{port}").parse()?;
        let listener = TcpListener::bind(addr).await?;
        println!("[ipc_server] Listening on http://127.0.0.1:{port}");

        loop {
            let (mut socket, _) = match listener.accept().await {
                Ok(conn) => conn,
                Err(_) => continue,
            };

            let server = self.clone();
            tokio::spawn(async move {
                let mut buf = vec![0u8; 65536];
                let n = match socket.read(&mut buf).await {
                    Ok(n) if n > 0 => n,
                    _ => return,
                };

                let request = String::from_utf8_lossy(&buf[..n]);

                // Basic HTTP parsing
                if request.starts_with("GET /api/ping") {
                    let body = r#"{"status":"online","app":"flowget","version":"1.0.0"}"#;
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = socket.write_all(resp.as_bytes()).await;
                    return;
                }

                if request.starts_with("OPTIONS") {
                    let resp = "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: POST, GET, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\n\r\n";
                    let _ = socket.write_all(resp.as_bytes()).await;
                    return;
                }

                // POST /api/download
                if let Some(body_start) = request.find("\r\n\r\n") {
                    let body_str = &request[body_start + 4..];
                    if let Ok(payload) = serde_json::from_str::<BrowserDownloadPayload>(body_str.trim()) {
                        println!("[ipc_server] Received download capture for URL: {}", payload.url);

                        // Emit to frontend UI
                        if let Some(ref handle) = server.app_handle {
                            let _ = handle.emit("browser-download-captured", &payload);
                        }

                        let res_body = r#"{"ok":true,"message":"captured"}"#;
                        let resp = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\n\r\n{}",
                            res_body.len(),
                            res_body
                        );
                        let _ = socket.write_all(resp.as_bytes()).await;
                        return;
                    }
                }

                let not_found = "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n";
                let _ = socket.write_all(not_found.as_bytes()).await;
            });
        }
    }
}
