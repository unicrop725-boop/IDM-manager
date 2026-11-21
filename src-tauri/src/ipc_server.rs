//! Local loopback IPC server connecting browser extensions and the native host to FlowGet.
//!
//! Anything on the machine can open a TCP connection to 127.0.0.1, including web pages in the user's
//! browser (via `fetch`) and DNS-rebinding sites. The rules below keep those out:
//!
//! * No CORS headers are ever sent and `OPTIONS` pre-flights are refused, so a web page cannot make
//!   the browser allow a JSON request or read a response.
//! * If an `Origin` header is present it must be a browser extension (`chrome-extension://`,
//!   `moz-extension://`). The native host is a plain TCP client and sends none.
//! * The `Host` header must be this server's own loopback address (defeats DNS rebinding).
//! * `POST /api/download` needs `Content-Type: application/json` and a complete, size-capped body.
//! * The payload is validated (URL scheme allow-list, field types and lengths) and a `saveDir`
//!   chosen by the sender is discarded: the user picks the destination in the Add dialog.
//!
//! Residual risk: another *installed extension* can still talk to this port. A per-install secret
//! shared with the official extension would close that; see docs/security-review.md.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::payload_check;

const MAX_HEAD_BYTES: usize = 16 * 1024;
const MAX_BODY_BYTES: usize = 1024 * 1024;
const READ_TIMEOUT: Duration = Duration::from_secs(5);

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

/// A parsed HTTP request (only what this server needs).
#[derive(Debug)]
pub(crate) struct HttpRequest {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl HttpRequest {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

/// What to answer, and (for an accepted download) what to hand to the UI.
#[derive(Debug)]
pub(crate) struct Reply {
    pub status: u16,
    pub body: String,
    pub capture: Option<BrowserDownloadPayload>,
}

impl Reply {
    fn error(status: u16, msg: &str) -> Self {
        Reply { status, body: serde_json::json!({ "ok": false, "error": msg }).to_string(), capture: None }
    }
}

/// Parse the request line and headers. Returns the request (empty body) and the declared body length.
pub(crate) fn parse_head(head: &str) -> Result<(HttpRequest, usize), u16> {
    let mut lines = head.split("\r\n");
    let request_line = lines.next().ok_or(400u16)?;
    let mut parts = request_line.split(' ');
    let method = parts.next().filter(|m| !m.is_empty()).ok_or(400u16)?.to_string();
    let path = parts.next().filter(|p| p.starts_with('/')).ok_or(400u16)?.to_string();
    let version = parts.next().ok_or(400u16)?;
    if !version.starts_with("HTTP/1.") {
        return Err(400);
    }
    let mut headers = Vec::new();
    for line in lines {
        if line.is_empty() {
            break;
        }
        let (k, v) = line.split_once(':').ok_or(400u16)?;
        headers.push((k.trim().to_string(), v.trim().to_string()));
    }
    let req = HttpRequest { method, path, headers, body: Vec::new() };
    let len = match req.header("content-length") {
        Some(v) => v.parse::<usize>().map_err(|_| 400u16)?,
        None => 0,
    };
    if len > MAX_BODY_BYTES {
        return Err(413);
    }
    Ok((req, len))
}

/// Decide what to do with a complete request. Pure, so it can be tested without sockets.
pub(crate) fn route(req: &HttpRequest, port: u16) -> Reply {
    // DNS rebinding: a rebinding page reaches us with its own hostname in `Host`.
    let host_ok = req.header("host").map_or(false, |h| {
        let h = h.to_ascii_lowercase();
        h == format!("127.0.0.1:{port}") || h == format!("localhost:{port}")
    });
    if !host_ok {
        return Reply::error(403, "forbidden host");
    }
    // A web page always sends Origin on cross-origin requests; only extensions may.
    if let Some(origin) = req.header("origin") {
        let o = origin.to_ascii_lowercase();
        if !(o.starts_with("chrome-extension://") || o.starts_with("moz-extension://")) {
            return Reply::error(403, "forbidden origin");
        }
    }

    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/api/ping") => Reply {
            status: 200,
            body: r#"{"status":"online","app":"flowget","version":"1.0.0"}"#.to_string(),
            capture: None,
        },
        ("POST", "/api/download") => {
            let is_json = req
                .header("content-type")
                .map_or(false, |c| c.trim().to_ascii_lowercase().starts_with("application/json"));
            if !is_json {
                return Reply::error(415, "content-type must be application/json");
            }
            let value: serde_json::Value = match serde_json::from_slice(&req.body) {
                Ok(v) => v,
                Err(_) => return Reply::error(400, "body is not valid JSON"),
            };
            if let Err(e) = payload_check::validate_download_payload(&value) {
                return Reply::error(400, &e);
            }
            let mut payload: BrowserDownloadPayload = match serde_json::from_value(value) {
                Ok(p) => p,
                Err(_) => return Reply::error(400, "unexpected message shape"),
            };
            // The sender does not get to pick where files are written.
            payload.save_dir = None;
            Reply { status: 200, body: r#"{"ok":true,"message":"captured"}"#.to_string(), capture: Some(payload) }
        }
        ("OPTIONS", _) => Reply::error(403, "cross-origin requests are not allowed"),
        _ => Reply::error(404, "not found"),
    }
}

fn status_text(code: u16) -> &'static str {
    match code {
        200 => "OK",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        413 => "Payload Too Large",
        415 => "Unsupported Media Type",
        _ => "Error",
    }
}

async fn write_reply<W: AsyncWrite + Unpin>(socket: &mut W, reply: &Reply) {
    let resp = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        reply.status,
        status_text(reply.status),
        reply.body.len(),
        reply.body
    );
    let _ = socket.write_all(resp.as_bytes()).await;
}

/// Read one complete request (head + declared body) with size and time limits.
async fn read_request<R: AsyncRead + Unpin>(socket: &mut R) -> Result<HttpRequest, u16> {
    let mut buf: Vec<u8> = Vec::with_capacity(2048);
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos;
        }
        if buf.len() > MAX_HEAD_BYTES {
            return Err(431);
        }
        let n = tokio::time::timeout(READ_TIMEOUT, socket.read(&mut chunk))
            .await
            .map_err(|_| 400u16)?
            .map_err(|_| 400u16)?;
        if n == 0 {
            return Err(400);
        }
        buf.extend_from_slice(&chunk[..n]);
    };

    let head = std::str::from_utf8(&buf[..head_end]).map_err(|_| 400u16)?;
    let (mut req, len) = parse_head(head)?;
    let mut body = buf[head_end + 4..].to_vec();
    while body.len() < len {
        let n = tokio::time::timeout(READ_TIMEOUT, socket.read(&mut chunk))
            .await
            .map_err(|_| 400u16)?
            .map_err(|_| 400u16)?;
        if n == 0 {
            return Err(400);
        }
        body.extend_from_slice(&chunk[..n]);
        if body.len() > MAX_BODY_BYTES {
            return Err(413);
        }
    }
    body.truncate(len);
    req.body = body;
    Ok(req)
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

    /// Serve one connection.
    pub(crate) async fn handle_connection<S>(&self, mut socket: S, port: u16)
    where
        S: AsyncRead + AsyncWrite + Unpin,
    {
        let reply = match read_request(&mut socket).await {
            Ok(req) => route(&req, port),
            Err(code) => Reply::error(code, "bad request"),
        };
        if let (Some(payload), Some(handle)) = (&reply.capture, &self.app_handle) {
            println!("[ipc_server] Received download capture for URL: {}", payload.url);
            // Like IDM's pop-up: make sure the user sees the download dialog even if FlowGet is behind the browser.
            if let Some(w) = handle.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_always_on_top(true);
                let _ = w.set_always_on_top(false);
                let _ = w.set_focus();
            }
            let _ = handle.emit("browser-download-captured", payload);
        }
        write_reply(&mut socket, &reply).await;
    }

    /// Run the local loopback TCP listener on `port` (127.0.0.1 only).
    pub async fn run(self: Arc<Self>, port: u16) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let addr: SocketAddr = format!("127.0.0.1:{port}").parse()?;
        let listener = TcpListener::bind(addr).await?;
        println!("[ipc_server] Listening on http://127.0.0.1:{port}");

        loop {
            let (socket, _) = match listener.accept().await {
                Ok(conn) => conn,
                Err(_) => continue,
            };
            let server = self.clone();
            tokio::spawn(async move {
                server.handle_connection(socket, port).await;
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PORT: u16 = 21588;

    fn req(method: &str, path: &str, headers: &[(&str, &str)], body: &str) -> HttpRequest {
        HttpRequest {
            method: method.into(),
            path: path.into(),
            headers: headers.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            body: body.as_bytes().to_vec(),
        }
    }

    const GOOD_HOST: (&str, &str) = ("Host", "127.0.0.1:21588");
    const JSON: (&str, &str) = ("Content-Type", "application/json");
    const GOOD_BODY: &str = r#"{"action":"add_download","url":"https://example.com/a.zip","fileName":"a.zip","saveDir":"C:\\Windows\\System32"}"#;

    #[test]
    fn extension_request_is_accepted_and_save_dir_is_discarded() {
        let r = route(&req("POST", "/api/download", &[GOOD_HOST, JSON, ("Origin", "chrome-extension://abcdefghijklmnopabcdefghijklmnop")], GOOD_BODY), PORT);
        assert_eq!(r.status, 200);
        let p = r.capture.expect("captured");
        assert_eq!(p.url, "https://example.com/a.zip");
        assert!(p.save_dir.is_none(), "remote-chosen save dir must be dropped");
    }

    #[test]
    fn native_host_request_without_origin_is_accepted() {
        let r = route(&req("POST", "/api/download", &[GOOD_HOST, JSON], GOOD_BODY), PORT);
        assert_eq!(r.status, 200);
    }

    #[test]
    fn web_page_origin_is_refused() {
        for origin in ["https://evil.example", "http://localhost:3000", "null", "file://"] {
            let r = route(&req("POST", "/api/download", &[GOOD_HOST, JSON, ("Origin", origin)], GOOD_BODY), PORT);
            assert_eq!(r.status, 403, "origin {origin}");
            assert!(r.capture.is_none());
        }
        let ping = route(&req("GET", "/api/ping", &[GOOD_HOST, ("Origin", "https://evil.example")], ""), PORT);
        assert_eq!(ping.status, 403);
    }

    #[test]
    fn dns_rebinding_host_is_refused() {
        let r = route(&req("POST", "/api/download", &[("Host", "evil.example:21588"), JSON], GOOD_BODY), PORT);
        assert_eq!(r.status, 403);
        let r = route(&req("POST", "/api/download", &[JSON], GOOD_BODY), PORT);
        assert_eq!(r.status, 403);
    }

    #[test]
    fn preflight_is_refused_and_no_cors_headers_are_sent() {
        let r = route(&req("OPTIONS", "/api/download", &[GOOD_HOST, ("Origin", "https://evil.example")], ""), PORT);
        assert_eq!(r.status, 403);
        let r = route(&req("OPTIONS", "/api/download", &[GOOD_HOST], ""), PORT);
        assert_eq!(r.status, 403);
        let src = include_str!("ipc_server.rs");
        let needle = ["Access-Control", "-Allow-Origin: *"].concat();
        assert!(!src.split("#[cfg(test)]").next().unwrap().contains(&needle));
    }

    #[test]
    fn simple_cross_site_content_types_are_refused() {
        for ct in ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"] {
            let r = route(&req("POST", "/api/download", &[GOOD_HOST, ("Content-Type", ct)], GOOD_BODY), PORT);
            assert_eq!(r.status, 415, "{ct}");
        }
        let r = route(&req("POST", "/api/download", &[GOOD_HOST], GOOD_BODY), PORT);
        assert_eq!(r.status, 415);
    }

    #[test]
    fn bad_payloads_are_refused() {
        for body in [
            "{",
            r#"{"url":"file:///C:/Windows/win.ini"}"#,
            r#"{"url":"--exec=calc"}"#,
            r#"{"fileName":"x"}"#,
            r#"[1,2]"#,
        ] {
            let r = route(&req("POST", "/api/download", &[GOOD_HOST, JSON], body), PORT);
            assert_eq!(r.status, 400, "{body}");
            assert!(r.capture.is_none());
        }
    }

    #[test]
    fn head_parsing_enforces_limits() {
        let (r, len) = parse_head("POST /api/download HTTP/1.1\r\nHost: 127.0.0.1:21588\r\nContent-Length: 12").unwrap();
        assert_eq!((r.method.as_str(), len), ("POST", 12));
        assert_eq!(parse_head("GARBAGE").unwrap_err(), 400);
        assert_eq!(parse_head("POST /x HTTP/1.1\r\nContent-Length: abc").unwrap_err(), 400);
        assert_eq!(parse_head(&format!("POST /x HTTP/1.1\r\nContent-Length: {}", MAX_BODY_BYTES + 1)).unwrap_err(), 413);
    }

    /// End to end over a real socket, including a body that arrives in several TCP segments
    /// (the old server did a single read and could cut a large request in half).
    #[tokio::test]
    async fn real_socket_round_trip_with_split_body() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = Arc::new(IpcServer::new_test());
        let s2 = server.clone();
        tokio::spawn(async move {
            loop {
                let (sock, _) = listener.accept().await.unwrap();
                let s = s2.clone();
                tokio::spawn(async move { s.handle_connection(sock, port).await });
            }
        });

        let cookies = "c=".to_string() + &"x".repeat(30_000);
        let body = serde_json::json!({"url": "https://example.com/big.iso", "cookies": cookies}).to_string();
        let head = format!(
            "POST /api/download HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );

        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        stream.write_all(head.as_bytes()).await.unwrap();
        let (a, b) = body.as_bytes().split_at(body.len() / 2);
        stream.write_all(a).await.unwrap();
        stream.flush().await.unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;
        stream.write_all(b).await.unwrap();

        let mut resp = String::new();
        stream.read_to_string(&mut resp).await.unwrap();
        assert!(resp.starts_with("HTTP/1.1 200 OK"), "{resp}");
        assert!(!resp.to_ascii_lowercase().contains("access-control"));

        // A web page's request to the same socket is refused.
        let mut evil = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        evil.write_all(
            format!("POST /api/download HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: https://evil.example\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}", body.len(), body).as_bytes(),
        )
        .await
        .unwrap();
        let mut resp = String::new();
        evil.read_to_string(&mut resp).await.unwrap();
        assert!(resp.starts_with("HTTP/1.1 403"), "{resp}");
    }
}
