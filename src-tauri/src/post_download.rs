//! Post-download automation actions:
//! - Auto-extract archive files (ZIP, RAR, 7Z, TAR, GZ)
//! - Windows Defender virus scan
//! - Open folder / reveal in Windows Explorer
//! - Open file

use std::path::{Path, PathBuf};

pub struct PostDownloadManager;

impl PostDownloadManager {
    /// Inspect file extension and determine if it's an archive format.
    pub fn is_archive(path: &Path) -> bool {
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_lowercase();
        name.ends_with(".zip")
            || name.ends_with(".rar")
            || name.ends_with(".7z")
            || name.ends_with(".tar")
            || name.ends_with(".gz")
            || name.ends_with(".tgz")
            || name.ends_with(".tar.gz")
            || name.ends_with(".bz2")
            || name.ends_with(".xz")
    }

    /// Automatically extract archive file into a folder with the same stem name.
    pub async fn extract_archive(path_str: &str, target_dir: Option<&str>) -> Result<String, String> {
        let path = PathBuf::from(path_str);
        if !path.exists() {
            return Err(format!("File does not exist: {path_str}"));
        }

        let out_dir = match target_dir {
            Some(d) => PathBuf::from(d),
            None => {
                let parent = path.parent().unwrap_or_else(|| Path::new("."));
                let stem = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("extracted");
                // Remove trailing .tar if was .tar.gz
                let clean_stem = stem.strip_suffix(".tar").unwrap_or(stem);
                parent.join(clean_stem)
            }
        };

        std::fs::create_dir_all(&out_dir)
            .map_err(|e| format!("Could not create extraction destination: {e}"))?;

        let name_lower = path_str.to_lowercase();

        // Use Windows built-in tar.exe if available (supports zip, tar, gz, 7z)
        let status = crate::tools::hide_window(&mut std::process::Command::new("tar.exe"))
            .arg("-xf")
            .arg(&path)
            .arg("-C")
            .arg(&out_dir)
            .status();

        match status {
            Ok(s) if s.success() => Ok(out_dir.to_string_lossy().to_string()),
            _ => {
                // If tar.exe failed and it is a .zip, fallback to PowerShell Expand-Archive
                if name_lower.ends_with(".zip") {
                    // The file name is attacker-controlled (Content-Disposition) and may contain
                    // quotes or `;`, so it must never be spliced into the command text. The paths
                    // travel in environment variables and the command is a constant.
                    let ps_status = crate::tools::hide_window(&mut std::process::Command::new("powershell"))
                        .args([
                            "-NoProfile",
                            "-NonInteractive",
                            "-Command",
                            "Expand-Archive -LiteralPath $env:FLOWGET_ARCHIVE -DestinationPath $env:FLOWGET_DEST -Force",
                        ])
                        .env("FLOWGET_ARCHIVE", &path)
                        .env("FLOWGET_DEST", &out_dir)
                        .status();
                    match ps_status {
                        Ok(s) if s.success() => Ok(out_dir.to_string_lossy().to_string()),
                        Ok(s) => Err(format!("Extraction exited with status code: {:?}", s.code())),
                        Err(e) => Err(format!("Extraction command failed: {e}")),
                    }
                } else {
                    Err("Archive extraction failed or format not supported by system decompressor.".to_string())
                }
            }
        }
    }

    /// Perform a custom on-demand virus scan using Windows Defender (MpCmdRun.exe).
    pub async fn scan_file(path_str: &str) -> Result<String, String> {
        let path = PathBuf::from(path_str);
        if !path.exists() {
            return Err(format!("File not found: {path_str}"));
        }

        let defender_paths = [
            r"C:\Program Files\Windows Defender\MpCmdRun.exe",
            r"C:\ProgramData\Microsoft\Windows Defender\Platform",
        ];

        let mut exe_path = PathBuf::from(defender_paths[0]);
        if !exe_path.exists() {
            // Find platform-specific subfolder if standard path moved
            if let Ok(entries) = std::fs::read_dir(defender_paths[1]) {
                for entry in entries.flatten() {
                    let candidate = entry.path().join("MpCmdRun.exe");
                    if candidate.exists() {
                        exe_path = candidate;
                        break;
                    }
                }
            }
        }

        if !exe_path.exists() {
            return Err("Windows Defender CLI (MpCmdRun.exe) was not found on this system.".into());
        }

        let output = crate::tools::hide_window(&mut std::process::Command::new(exe_path))
            .args(["-Scan", "-ScanType", "3", "-File", path_str])
            .output()
            .map_err(|e| format!("Failed to run Windows Defender: {e}"))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        match output.status.code() {
            Some(0) => Ok("Clean: No threats detected by Windows Defender.".into()),
            Some(2) => Ok("Warning: Threats detected! Please review Windows Security.".into()),
            Some(code) => Ok(format!(
                "Scan finished with exit code {code}.\nOutput: {stdout}\nErrors: {stderr}"
            )),
            None => Err("Scan process terminated abnormally.".into()),
        }
    }

    /// Open folder and highlight the downloaded file in File Explorer.
    pub fn reveal_in_explorer(path_str: &str) -> Result<(), String> {
        let path = PathBuf::from(path_str);
        if !path.exists() {
            return Err(format!("File does not exist: {path_str}"));
        }

        std::process::Command::new("explorer.exe")
            .arg(format!("/select,\"{}\"", path.display()))
            .spawn()
            .map_err(|e| format!("Failed to open Windows Explorer: {e}"))?;
        Ok(())
    }

    /// Open file using the default Windows application.
    pub fn open_file(path_str: &str) -> Result<(), String> {
        let path = PathBuf::from(path_str);
        if !path.exists() {
            return Err(format!("File does not exist: {path_str}"));
        }

        // Not via `cmd /C start`: cmd would interpret `&`, `^` and `%` in the file name, and a
        // downloaded file called `x&calc.exe` would run a second command. explorer.exe receives the
        // path as one argument and opens it with the default application.
        std::process::Command::new("explorer.exe")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {e}"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A server controls the file name. This corrupt "zip" is named so that, when its path used to be
    /// pasted into a PowerShell command line, it ran `ni flowget_pwned_marker` (verified against the
    /// old code: the marker was created) (creating a file in the
    /// working directory). tar.exe fails on it, which triggers the PowerShell fallback.
    #[tokio::test]
    async fn extraction_does_not_execute_commands_hidden_in_the_file_name() {
        let marker = std::env::current_dir().unwrap().join("flowget_pwned_marker");
        let _ = std::fs::remove_file(&marker);

        let dir = tempfile::tempdir().unwrap();
        // `#` comments out the rest of the old command line, so it still parsed and ran.
        let evil = dir.path().join("a'; ni flowget_pwned_marker #.zip");
        std::fs::write(&evil, b"this is not a zip archive").unwrap();

        let _ = PostDownloadManager::extract_archive(evil.to_str().unwrap(), None).await;

        let injected = marker.exists();
        let _ = std::fs::remove_file(&marker);
        assert!(!injected, "the file name was executed as PowerShell code");
    }
}
