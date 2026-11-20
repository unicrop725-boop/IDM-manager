// src-tauri/src/licensing.rs
//! Secure multi-location 30-day trial & Ed25519 offline license verification.

use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ring::signature::{UnparsedPublicKey, ED25519};
use serde::{Deserialize, Serialize};

use crate::db::Db;

/// Embedded Ed25519 Public Key for FlowGet Offline License Verification
pub const PUBLIC_KEY_HEX: &str = "ded7e146d3187012e95c8a8913f5be710c6cafd0a741511f6185cf4879a9f796";

pub const TRIAL_DURATION_SECS: u64 = 30 * 86400; // 30 Days

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LicensePayload {
    pub key_id: String,
    pub email: String,
    pub tier: String,
    #[serde(default)]
    pub max_devices: u32,
    #[serde(default)]
    pub issued_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrialAndLicenseStatus {
    pub is_licensed: bool,
    pub is_trial: bool,
    pub is_expired: bool,
    pub days_remaining: u32,
    pub trial_started_at: u64,
    pub max_connections: u32,
    pub turbo_mode_allowed: bool,
    pub media_download_allowed: bool,
    pub license_key: Option<String>,
    pub license_email: Option<String>,
    pub license_tier: Option<String>,
}

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Decode hex string into byte vector
fn decode_hex(hex_str: &str) -> Result<Vec<u8>, String> {
    (0..hex_str.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&hex_str[i..i + 2], 16)
                .map_err(|e| format!("Invalid hex character at {i}: {e}"))
        })
        .collect()
}

/// Verify Ed25519 license key offline
pub fn verify_offline_license(license_key: &str) -> Result<LicensePayload, String> {
    let parts: Vec<&str> = license_key.trim().split('.').collect();
    if parts.len() != 3 || parts[0] != "FG1" {
        return Err("Invalid license key format. Expected FG1.<payload>.<sig>".to_string());
    }

    let payload_b64 = parts[1];
    let sig_b64 = parts[2];

    let payload_bytes = URL_SAFE_NO_PAD
        .decode(payload_b64)
        .map_err(|e| format!("Failed to decode license payload: {e}"))?;

    let sig_bytes = URL_SAFE_NO_PAD
        .decode(sig_b64)
        .map_err(|e| format!("Failed to decode license signature: {e}"))?;

    let pub_bytes = decode_hex(PUBLIC_KEY_HEX)?;
    let public_key = UnparsedPublicKey::new(&ED25519, &pub_bytes);

    public_key
        .verify(payload_b64.as_bytes(), &sig_bytes)
        .map_err(|_| "Cryptographic license signature verification failed. Invalid or forged key.".to_string())?;

    let payload: LicensePayload = serde_json::from_slice(&payload_bytes)
        .map_err(|e| format!("Corrupted license metadata: {e}"))?;

    Ok(payload)
}

// ----------------- Multi-Location Trial Persistence -----------------

/// Path to redundant hidden machine seed file
fn get_machine_seed_file() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("APPDATA"))
        .map(|dir| PathBuf::from(dir).join("FlowGet").join(".sys_trial_seed"))
}

/// Read seed from file
fn read_file_seed() -> Option<u64> {
    let path = get_machine_seed_file()?;
    let content = fs::read_to_string(path).ok()?;
    let trimmed = content.trim();
    trimmed.parse::<u64>().ok()
}

/// Write seed to file
fn write_file_seed(ts: u64) {
    if let Some(path) = get_machine_seed_file() {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(path, ts.to_string());
    }
}

/// Read seed from Windows Registry
#[cfg(target_os = "windows")]
fn read_registry_seed() -> Option<u64> {
    let output = Command::new("reg")
        .args(["query", "HKCU\\Software\\FlowGet", "/v", "TrialSeed"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if line.contains("TrialSeed") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 3 {
                return parts[2].parse::<u64>().ok();
            }
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn read_registry_seed() -> Option<u64> {
    None
}

/// Write seed to Windows Registry
#[cfg(target_os = "windows")]
fn write_registry_seed(ts: u64) {
    let _ = Command::new("reg")
        .args([
            "add",
            "HKCU\\Software\\FlowGet",
            "/v",
            "TrialSeed",
            "/t",
            "REG_SZ",
            "/d",
            &ts.to_string(),
            "/f",
        ])
        .output();
}

#[cfg(not(target_os = "windows"))]
fn write_registry_seed(_ts: u64) {}

/// Get securely established trial start timestamp using multi-location redundancy
pub async fn get_or_init_trial_start(db: &Db) -> u64 {
    let db_ts = db
        .get_setting("trial_started_at")
        .await
        .and_then(|s| s.parse::<u64>().ok());
    let file_ts = read_file_seed();
    let reg_ts = read_registry_seed();

    let mut timestamps = Vec::new();
    if let Some(ts) = db_ts {
        if ts > 0 {
            timestamps.push(ts);
        }
    }
    if let Some(ts) = file_ts {
        if ts > 0 {
            timestamps.push(ts);
        }
    }
    if let Some(ts) = reg_ts {
        if ts > 0 {
            timestamps.push(ts);
        }
    }

    if timestamps.is_empty() {
        // First install! Create fresh trial starting now
        let now = current_timestamp();
        let _ = db.set_setting("trial_started_at", &now.to_string()).await;
        write_file_seed(now);
        write_registry_seed(now);
        now
    } else {
        // Take the MINIMUM (oldest) timestamp detected across all stores to prevent rollback
        let oldest = *timestamps.iter().min().unwrap();

        // Self-heal any location that was deleted or tampered forward
        if db_ts != Some(oldest) {
            let _ = db.set_setting("trial_started_at", &oldest.to_string()).await;
        }
        if file_ts != Some(oldest) {
            write_file_seed(oldest);
        }
        if reg_ts != Some(oldest) {
            write_registry_seed(oldest);
        }

        oldest
    }
}

/// Evaluate current trial and license status
pub async fn get_status(db: &Db) -> TrialAndLicenseStatus {
    let now = current_timestamp();
    let trial_start = get_or_init_trial_start(db).await;

    // Check license in DB
    let saved_key: Option<String> = db.get_setting("license_key").await;
    let mut is_licensed = false;
    let mut license_email = None;
    let mut license_tier = None;

    if let Some(ref key) = saved_key {
        if !key.is_empty() {
            if let Ok(payload) = verify_offline_license(key) {
                is_licensed = true;
                license_email = Some(payload.email);
                license_tier = Some(payload.tier);
            }
        }
    }

    let elapsed = now.saturating_sub(trial_start);
    let days_remaining = if elapsed < TRIAL_DURATION_SECS {
        let secs_left = TRIAL_DURATION_SECS - elapsed;
        ((secs_left + 86399) / 86400) as u32
    } else {
        0
    };

    let is_expired = !is_licensed && days_remaining == 0;
    let is_trial = !is_licensed && !is_expired;

    // Feature gating per Phase 8 rules:
    // If trial expired and unlicensed:
    // - keep basic downloading working
    // - limit to 2 connections
    // - disable turbo mode, mirrors, media stream download
    let max_connections = if is_licensed || is_trial { 32 } else { 2 };
    let turbo_mode_allowed = is_licensed || is_trial;
    let media_download_allowed = is_licensed || is_trial;

    TrialAndLicenseStatus {
        is_licensed,
        is_trial,
        is_expired,
        days_remaining,
        trial_started_at: trial_start,
        max_connections,
        turbo_mode_allowed,
        media_download_allowed,
        license_key: if is_licensed { saved_key } else { None },
        license_email,
        license_tier,
    }
}

/// Activate a license key
pub async fn activate_license(db: &Db, key: &str) -> Result<TrialAndLicenseStatus, String> {
    let payload = verify_offline_license(key)?;
    db.set_setting("license_key", key)
        .await
        .map_err(|e| format!("Failed to save license: {e}"))?;
    db.set_setting("license_email", &payload.email)
        .await
        .map_err(|e| format!("Failed to save license metadata: {e}"))?;
    db.set_setting("license_tier", &payload.tier)
        .await
        .map_err(|e| format!("Failed to save license metadata: {e}"))?;

    Ok(get_status(db).await)
}

/// Deactivate current license (for transferring to another PC)
pub async fn deactivate_license(db: &Db) -> Result<TrialAndLicenseStatus, String> {
    let _ = db.set_setting("license_key", "").await;
    let _ = db.set_setting("license_email", "").await;
    let _ = db.set_setting("license_tier", "").await;
    Ok(get_status(db).await)
}
