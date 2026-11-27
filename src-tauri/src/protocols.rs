//! Handlers for FTP, FTPS, and SFTP protocols.

use std::path::Path;
use std::process::Command;

use url::Url;

/// Checks if the URL matches FTP, FTPS, or SFTP scheme.
pub fn is_ftp_or_sftp(url: &str) -> bool {
    let lower = url.trim().to_lowercase();
    lower.starts_with("ftp://") || lower.starts_with("ftps://") || lower.starts_with("sftp://")
}

/// Download a file via FTP or FTPS.
pub async fn download_ftp(
    url: &str,
    output_path: &Path,
    user: Option<&str>,
    pass: Option<&str>,
) -> Result<(), String> {
    let mut parsed_url = Url::parse(url).map_err(|e| format!("Invalid FTP URL: {e}"))?;
    if let Some(u) = user {
        let _ = parsed_url.set_username(u);
    }
    if let Some(p) = pass {
        let _ = parsed_url.set_password(Some(p));
    }

    let url_str = parsed_url.to_string();
    let out_path = output_path.to_string_lossy().to_string();

    tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new("curl.exe");
        cmd.args([
            "--fail",
            // Only FTP(S), also across redirects: a server must not bounce us to file:// or similar.
            "--proto",
            "=ftp,ftps",
            "--proto-redir",
            "=ftp,ftps",
            "--location",
            "--continue-at",
            "-",
            "-o",
            &out_path,
            &url_str,
        ]);

        crate::tools::hide_window(&mut cmd);
        let status = cmd.status().map_err(|e| format!("Failed to run the FTP transfer: {e}"))?;
        if !status.success() {
            return Err(format!("FTP download failed with exit code: {:?}", status.code()));
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The Python program that performs the SFTP transfer. It is a constant: nothing from the URL is ever
/// spliced into it (that would let a crafted link run arbitrary code). Values arrive as `sys.argv`,
/// the password as an environment variable so it is not visible in the process list.
///
/// Host keys are trusted on first use and then pinned in a FlowGet-owned known_hosts file; a
/// changed key for a known host makes paramiko raise `BadHostKeyException` and the download fails.
const SFTP_SCRIPT: &str = r#"
import os, sys
import paramiko
host, port, user, remote, out, known_hosts = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4], sys.argv[5], sys.argv[6]
client = paramiko.SSHClient()
if os.path.exists(known_hosts):
    client.load_host_keys(known_hosts)
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, port=port, username=user, password=os.environ.get("FLOWGET_SFTP_PASSWORD", ""), allow_agent=False, look_for_keys=False)
client.save_host_keys(known_hosts)
sftp = client.open_sftp()
sftp.get(remote, out)
sftp.close()
client.close()
"#;

/// Everything the SFTP runner needs, decoded from the URL and validated.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct SftpParams {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub path: String,
}

/// Decode `%XX` escapes (URL userinfo and path arrive percent-encoded).
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

pub(crate) fn sftp_params(url: &str, user: Option<&str>, pass: Option<&str>) -> Result<SftpParams, String> {
    let parsed = Url::parse(url).map_err(|e| format!("Invalid SFTP URL: {e}"))?;
    if parsed.scheme() != "sftp" {
        return Err("Not an sftp:// URL".into());
    }
    let host = parsed.host_str().filter(|h| !h.is_empty()).ok_or("SFTP URL has no host")?.to_string();
    let username = match user {
        Some(u) => u.to_string(),
        None if !parsed.username().is_empty() => percent_decode(parsed.username()),
        None => "anonymous".to_string(),
    };
    let password = match pass {
        Some(p) => p.to_string(),
        None => parsed.password().map(percent_decode).unwrap_or_default(),
    };
    Ok(SftpParams {
        host,
        port: parsed.port().unwrap_or(22),
        user: username,
        password,
        path: percent_decode(parsed.path()),
    })
}

fn known_hosts_path() -> std::path::PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let dir = base.join("FlowGet");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("sftp_known_hosts")
}

/// Download a file via SFTP using paramiko (needs Python + paramiko installed).
pub async fn download_sftp(
    url: &str,
    output_path: &Path,
    user: Option<&str>,
    pass: Option<&str>,
) -> Result<(), String> {
    let p = sftp_params(url, user, pass)?;
    let out_path = output_path.to_string_lossy().to_string();
    let known_hosts = known_hosts_path().to_string_lossy().to_string();

    tokio::task::spawn_blocking(move || {
        let status = crate::tools::hide_window(&mut Command::new("python"))
            .arg("-c")
            .arg(SFTP_SCRIPT)
            .arg(&p.host)
            .arg(p.port.to_string())
            .arg(&p.user)
            .arg(&p.path)
            .arg(&out_path)
            .arg(&known_hosts)
            .env("FLOWGET_SFTP_PASSWORD", &p.password)
            .status()
            .map_err(|e| format!("SFTP runner failed (is Python with paramiko installed?): {e}"))?;

        if !status.success() {
            return Err(format!("SFTP download failed with exit code: {:?}", status.code()));
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn script_is_constant_and_never_formatted_with_url_data() {
        // No placeholders: nothing can be spliced into the program.
        assert!(!SFTP_SCRIPT.contains("{host}") && !SFTP_SCRIPT.contains("{path}"));
        assert!(SFTP_SCRIPT.contains("sys.argv[1]"));
    }

    #[test]
    fn malicious_url_is_data_not_code() {
        // A single quote is NOT percent-encoded in URL userinfo/path, so this used to break out of
        // the Python string literal.
        let url = "sftp://u'%2B__import__('os').system('calc')%2B'@host.example/p'%3Bimport%20os";
        let p = sftp_params(url, None, None).unwrap();
        assert!(p.user.contains("__import__('os')"));
        assert_eq!(p.host, "host.example");
        // The decoded text only ever travels as an argv element, never inside SFTP_SCRIPT.
        assert!(!SFTP_SCRIPT.contains("__import__"));
    }

    #[test]
    fn rejects_other_schemes_and_missing_host() {
        assert!(sftp_params("http://h/p", None, None).is_err());
        assert!(sftp_params("sftp:///p", None, None).is_err());
    }

    #[test]
    fn defaults_and_percent_decoding() {
        let p = sftp_params("sftp://bob:p%40ss@h:2222/dir/a%20b.txt", None, None).unwrap();
        assert_eq!((p.user.as_str(), p.password.as_str(), p.port, p.path.as_str()), ("bob", "p@ss", 2222, "/dir/a b.txt"));
        let p = sftp_params("sftp://h/x", Some("u"), Some("pw")).unwrap();
        assert_eq!((p.user.as_str(), p.password.as_str(), p.port), ("u", "pw", 22));
    }
}
