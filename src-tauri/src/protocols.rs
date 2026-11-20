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
            "--location",
            "--continue-at",
            "-",
            "-o",
            &out_path,
            &url_str,
        ]);

        let status = cmd.status().map_err(|e| format!("Failed to run curl: {e}"))?;
        if !status.success() {
            return Err(format!("FTP download failed with exit code: {:?}", status.code()));
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Download a file via SFTP using paramiko or curl.
pub async fn download_sftp(
    url: &str,
    output_path: &Path,
    user: Option<&str>,
    pass: Option<&str>,
) -> Result<(), String> {
    let parsed_url = Url::parse(url).map_err(|e| format!("Invalid SFTP URL: {e}"))?;
    let host = parsed_url.host_str().unwrap_or("localhost").to_string();
    let port = parsed_url.port().unwrap_or(22);
    let path = parsed_url.path().to_string();
    let username = user
        .map(String::from)
        .or_else(|| {
            let u = parsed_url.username();
            if u.is_empty() {
                None
            } else {
                Some(u.to_string())
            }
        })
        .unwrap_or_else(|| "anonymous".to_string());
    let password = pass
        .map(String::from)
        .or_else(|| parsed_url.password().map(String::from))
        .unwrap_or_default();

    let out_path = output_path.to_string_lossy().to_string();

    tokio::task::spawn_blocking(move || {
        let python_script = format!(
            r#"
import paramiko, sys
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('{host}', port={port}, username='{username}', password='{password}')
sftp = client.open_sftp()
sftp.get('{path}', r'{out_path}')
sftp.close()
client.close()
"#
        );

        let status = Command::new("python")
            .args(["-c", &python_script])
            .status()
            .map_err(|e| format!("SFTP runner failed: {e}"))?;

        if !status.success() {
            return Err(format!("SFTP download failed with exit code: {:?}", status.code()));
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
