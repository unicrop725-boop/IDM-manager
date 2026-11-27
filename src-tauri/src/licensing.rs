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

/// How long a license keeps working without the license server confirming it. A key that was never confirmed (for
/// example a forged one, with the signing key exposed) stops working after this long; a genuine key is confirmed on
/// the first online start and then re-confirmed regularly, so honest users never notice. Change here to taste.
pub const LICENSE_GRACE_SECS: u64 = 14 * 86400;

/// Mixed into the seal on the "last confirmed" stamp. It stops people editing the database to extend the grace
/// period; it cannot stop someone who patches the program itself (nothing running on their PC can).
const SEAL_SECRET: &[u8] = b"flowget-license-seal-v1/6c1e0a52b7f84d39a0b2c5e18f7d3a94";

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
    /// Why the license stopped working on its own (refunded, or its slot went to another PC). Shown in the UI.
    #[serde(default)]
    pub license_notice: Option<String>,
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
    verify_with(license_key, PUBLIC_KEY_HEX)
}

fn verify_with(license_key: &str, public_key_hex: &str) -> Result<LicensePayload, String> {
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

    let pub_bytes = decode_hex(public_key_hex)?;
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
    let output = crate::tools::hide_window(&mut Command::new("reg"))
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
    let _ = crate::tools::hide_window(&mut Command::new("reg"))
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
    get_status_with(db, PUBLIC_KEY_HEX).await
}

/// Settings the license decides. They change only through their own commands (which look at the license): letting
/// the generic `set_setting` write them would let anyone, from the webview or by editing the database, switch on
/// Turbo or 32 connections, or overwrite the license bookkeeping.
pub const PROTECTED_SETTINGS: &[&str] = &[
    "license_key",
    "license_email",
    "license_tier",
    "license_notice",
    "license_checked_at",
    "machine_id",
    "trial_started_at",
    "turbo_mode",
    "default_connections",
];

pub fn is_protected_setting(key: &str) -> bool {
    let k = key.trim();
    PROTECTED_SETTINGS.iter().any(|p| p.eq_ignore_ascii_case(k))
}

/// Gives the download engine the limits that the *verified* license allows (connection ceiling, Turbo permission).
/// The engine enforces them itself, so saved settings, restored downloads and any caller stay inside them. Call it at
/// start-up and whenever the license changes.
pub async fn enforce_on_engine(db: &Db, engine: &flowget_engine::Engine) -> TrialAndLicenseStatus {
    enforce_with(db, engine, PUBLIC_KEY_HEX).await
}

async fn enforce_with(db: &Db, engine: &flowget_engine::Engine, public_key_hex: &str) -> TrialAndLicenseStatus {
    let st = get_status_with(db, public_key_hex).await;
    engine.set_limits(st.max_connections, st.turbo_mode_allowed);
    st
}

async fn get_status_with(db: &Db, public_key_hex: &str) -> TrialAndLicenseStatus {
    let now = current_timestamp();
    let trial_start = 0u64;

    // Check license in DB
    let saved_key: Option<String> = db.get_setting("license_key").await;
    let mut is_licensed = false;
    let mut license_email = None;
    let mut license_tier = None;
    let mut needs_online_check = false;

    if let Some(ref key) = saved_key {
        if !key.is_empty() {
            if let Ok(payload) = verify_with(key, public_key_hex) {
                // A genuine signature is not enough: the license server must have confirmed this key on this PC
                // within the grace period (see LICENSE_GRACE_SECS).
                if confirmed_recently(db, key, now).await {
                    is_licensed = true;
                    license_email = Some(payload.email);
                    license_tier = Some(payload.tier);
                } else {
                    needs_online_check = true;
                }
            }
        }
    }

    // Paid-only: there is no free trial. Without a license the app runs in
    // limited basic mode (2 connections, no Turbo, no media streams).
    let _ = now;
    let days_remaining = 0u32;
    let is_expired = !is_licensed;
    let is_trial = false;

    let max_connections = if is_licensed { 32 } else { 2 };
    let turbo_mode_allowed = is_licensed;
    let media_download_allowed = is_licensed;

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
        license_notice: db.get_setting("license_notice").await.filter(|n| !n.is_empty()).or_else(|| {
            needs_online_check.then(|| {
                "Your license could not be confirmed online for a while. Connect to the internet and it will be checked again automatically.".to_string()
            })
        }),
    }
}

// ----------------- The sealed "last confirmed by the server" stamp -----------------

fn seal_hmac_key(machine_id: &str) -> ring::hmac::Key {
    let mut material = SEAL_SECRET.to_vec();
    material.extend_from_slice(machine_id.as_bytes());
    ring::hmac::Key::new(ring::hmac::HMAC_SHA256, &material)
}

/// `"<unix seconds>.<hmac hex>"`, bound to this license key and this PC.
fn seal_stamp(machine_id: &str, license_key: &str, ts: u64) -> String {
    let tag = ring::hmac::sign(&seal_hmac_key(machine_id), format!("{license_key}|{ts}").as_bytes());
    format!("{ts}.{}", to_hex(tag.as_ref()))
}

/// The time inside a stamp, only if the seal is genuine. Never panics on garbage from the database.
fn open_stamp(machine_id: &str, license_key: &str, value: &str) -> Option<u64> {
    let (ts_text, tag_hex) = value.trim().split_once('.')?;
    let ts = ts_text.parse::<u64>().ok()?;
    if tag_hex.len() != 64 || !tag_hex.is_ascii() {
        return None;
    }
    let tag = decode_hex(tag_hex).ok()?;
    ring::hmac::verify(&seal_hmac_key(machine_id), format!("{license_key}|{ts}").as_bytes(), &tag).ok()?;
    Some(ts)
}

/// Records "the server (or a fresh activation) vouched for this key now".
async fn stamp_confirmed(db: &Db, license_key: &str) {
    let id = machine_id(db).await;
    let _ = db.set_setting("license_checked_at", &seal_stamp(&id, license_key, current_timestamp())).await;
}

/// True when a genuine stamp for this key and PC is not in the future (a clock set back, or a stamp edited forward)
/// and not older than the grace period.
async fn confirmed_recently(db: &Db, license_key: &str, now: u64) -> bool {
    let id = machine_id(db).await;
    let Some(raw) = db.get_setting("license_checked_at").await else { return false };
    match open_stamp(&id, license_key, &raw) {
        Some(t) => t <= now + 300 && now.saturating_sub(t) <= LICENSE_GRACE_SECS,
        None => false,
    }
}

// ----------------- Online check: device limit and refunds -----------------
//
// The key itself is always verified offline (above), so the app keeps working without internet. On top of that the
// license server is asked to register this PC (max 2 per key) and to say whether the key was refunded. Only a clear
// "no" (HTTP 403) takes the license away; being offline, or a server hiccup, never does.

/// Where the license server lives.
pub const DEFAULT_LICENSE_API: &str = "https://api.flowget.net";

/// In DEBUG builds `FLOWGET_LICENSE_API` may point the app at a test server. A release build ignores it: otherwise a
/// single environment variable pointing at a fake server that always answers "OK" would switch off the refund and
/// device-limit checks.
fn api_base() -> String {
    #[cfg(debug_assertions)]
    {
        if let Some(s) = std::env::var("FLOWGET_LICENSE_API")
            .ok()
            .map(|s| s.trim().trim_end_matches('/').to_string())
            .filter(|s| !s.is_empty())
        {
            return s;
        }
    }
    DEFAULT_LICENSE_API.to_string()
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(target_os = "windows")]
fn windows_machine_guid() -> Option<String> {
    let out = crate::tools::hide_window(&mut Command::new("reg"))
        .args(["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"])
        .output()
        .ok()?;
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .find(|l| l.contains("MachineGuid"))
        .and_then(|l| l.split_whitespace().last().map(str::to_string))
        .filter(|g| g.len() >= 8)
}

#[cfg(not(target_os = "windows"))]
fn windows_machine_guid() -> Option<String> {
    None
}

/// A stable, anonymous id for this PC: a hash of Windows' machine GUID (never sent as is), or a random id that is
/// remembered in the database when the GUID cannot be read.
async fn machine_id(db: &Db) -> String {
    if let Some(id) = db.get_setting("machine_id").await.filter(|s| s.len() >= 16) {
        return id;
    }
    let seed = windows_machine_guid().unwrap_or_else(|| {
        let mut b = [0u8; 16];
        let _ = ring::rand::SecureRandom::fill(&ring::rand::SystemRandom::new(), &mut b);
        to_hex(&b)
    });
    let digest = ring::digest::digest(&ring::digest::SHA256, format!("flowget-machine:{seed}").as_bytes());
    let id = to_hex(digest.as_ref());
    let _ = db.set_setting("machine_id", &id).await;
    id
}

fn machine_name() -> String {
    std::env::var("COMPUTERNAME").ok().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| "Windows PC".to_string())
}

#[derive(Debug, PartialEq)]
enum Verdict {
    /// The server registered this PC (or already knew it).
    Accepted,
    /// The server said no: refunded, or both slots are taken by other PCs. Carries its message.
    Refused(String),
    /// The server does not know this key (never issued, or the server's records were lost). The key stays stored so
    /// the license comes back by itself if the server's records are restored.
    UnknownKey(String),
    /// No answer we can act on: offline, timeout, 5xx, rate limit...
    Unreachable,
}

async fn call_server(base: &str, path: &str, key: &str, machine_id: &str) -> Verdict {
    let client = match reqwest::Client::builder().timeout(std::time::Duration::from_secs(8)).build() {
        Ok(c) => c,
        Err(_) => return Verdict::Unreachable,
    };
    let resp = match client
        .post(format!("{base}{path}"))
        .json(&serde_json::json!({ "licenseKey": key, "machineId": machine_id, "machineName": machine_name() }))
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return Verdict::Unreachable,
    };
    let status = resp.status();
    if status.is_success() {
        return Verdict::Accepted;
    }
    if status.as_u16() == 403 {
        let body = resp.json::<serde_json::Value>().await.ok();
        let msg = body
            .as_ref()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_string))
            .unwrap_or_else(|| "The license server refused this key.".to_string());
        let unknown = body.as_ref().and_then(|v| v.get("code")).and_then(|c| c.as_str()) == Some("unknown_key");
        return if unknown { Verdict::UnknownKey(msg) } else { Verdict::Refused(msg) };
    }
    Verdict::Unreachable
}

async fn clear_local_license(db: &Db) {
    let _ = db.set_setting("license_key", "").await;
    let _ = db.set_setting("license_email", "").await;
    let _ = db.set_setting("license_tier", "").await;
}

/// Activate a license key on this PC.
pub async fn activate_license(db: &Db, key: &str) -> Result<TrialAndLicenseStatus, String> {
    activate_license_with(db, key, PUBLIC_KEY_HEX, &api_base()).await
}

async fn activate_license_with(db: &Db, key: &str, public_key_hex: &str, base: &str) -> Result<TrialAndLicenseStatus, String> {
    let key = key.trim();
    let payload = verify_with(key, public_key_hex)?;

    match call_server(base, "/api/license/activate", key, &machine_id(db).await).await {
        Verdict::Refused(msg) | Verdict::UnknownKey(msg) => return Err(msg),
        Verdict::Accepted => {}
        // Offline: the signature is genuine, so it works now (the grace period starts here) and is checked with the
        // server the next time we are online. If it turns out the server never issued it, it stops then.
        Verdict::Unreachable => {}
    }
    stamp_confirmed(db, key).await;

    db.set_setting("license_key", key)
        .await
        .map_err(|e| format!("Failed to save license: {e}"))?;
    db.set_setting("license_email", &payload.email)
        .await
        .map_err(|e| format!("Failed to save license metadata: {e}"))?;
    db.set_setting("license_tier", &payload.tier)
        .await
        .map_err(|e| format!("Failed to save license metadata: {e}"))?;
    let _ = db.set_setting("license_notice", "").await;

    Ok(get_status_with(db, public_key_hex).await)
}

/// Deactivate current license (for transferring to another PC). Frees this PC's slot on the server when it can.
pub async fn deactivate_license(db: &Db) -> Result<TrialAndLicenseStatus, String> {
    deactivate_license_with(db, PUBLIC_KEY_HEX, &api_base()).await
}

async fn deactivate_license_with(db: &Db, public_key_hex: &str, base: &str) -> Result<TrialAndLicenseStatus, String> {
    if let Some(key) = db.get_setting("license_key").await.filter(|k| !k.is_empty()) {
        let id = machine_id(db).await;
        // Best effort and quick: being offline must not stop the user from deactivating.
        let _ = tokio::time::timeout(std::time::Duration::from_secs(4), call_server(base, "/api/license/deactivate", &key, &id)).await;
    }
    clear_local_license(db).await;
    let _ = db.set_setting("license_notice", "").await;
    Ok(get_status_with(db, public_key_hex).await)
}

/// Asks the server again whether this PC may keep using its license. Returns true when the licensed state changed
/// (taken away, or restored), so the UI should refresh. Run at start-up and then every few hours.
pub async fn recheck_license(db: &Db) -> bool {
    recheck_with(db, PUBLIC_KEY_HEX, &api_base()).await
}

async fn recheck_with(db: &Db, public_key_hex: &str, base: &str) -> bool {
    let Some(key) = db.get_setting("license_key").await.filter(|k| !k.is_empty()) else {
        return false;
    };
    if verify_with(&key, public_key_hex).is_err() {
        return false;
    }
    let before = get_status_with(db, public_key_hex).await.is_licensed;
    match call_server(base, "/api/license/activate", &key, &machine_id(db).await).await {
        Verdict::Refused(msg) => {
            clear_local_license(db).await;
            let _ = db.set_setting("license_notice", &format!("Your license was turned off: {msg}")).await;
            return true;
        }
        Verdict::UnknownKey(msg) => {
            // Not issued by us: stops working now. The key stays stored, so if our records were merely lost and are
            // restored, the next check brings the license back without the customer doing anything.
            let _ = db.set_setting("license_checked_at", "").await;
            let _ = db.set_setting("license_notice", &format!("Your license could not be verified: {msg}")).await;
        }
        Verdict::Accepted => {
            stamp_confirmed(db, &key).await;
            let _ = db.set_setting("license_notice", "").await;
        }
        // Offline or a server hiccup: nothing changes; the grace period keeps counting.
        Verdict::Unreachable => {}
    }
    get_status_with(db, public_key_hex).await.is_licensed != before
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::signature::{Ed25519KeyPair, KeyPair};
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    struct TestKeys {
        public_hex: String,
        pair: Ed25519KeyPair,
    }

    fn test_keys() -> TestKeys {
        let rng = ring::rand::SystemRandom::new();
        let pkcs8 = Ed25519KeyPair::generate_pkcs8(&rng).unwrap();
        let pair = Ed25519KeyPair::from_pkcs8(pkcs8.as_ref()).unwrap();
        TestKeys { public_hex: to_hex(pair.public_key().as_ref()), pair }
    }

    fn sign(keys: &TestKeys, email: &str) -> String {
        let payload = serde_json::json!({ "keyId": "FG-TEST", "email": email, "tier": "lifetime", "maxDevices": 2, "issuedAt": 1 }).to_string();
        let p = URL_SAFE_NO_PAD.encode(payload.as_bytes());
        let sig = URL_SAFE_NO_PAD.encode(keys.pair.sign(p.as_bytes()).as_ref());
        format!("FG1.{p}.{sig}")
    }

    /// A tiny license server: answers every request with `status`/`body` and remembers the request lines.
    async fn mock_server(status: u16, body: &'static str) -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let seen2 = seen.clone();
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else { return };
                let seen = seen2.clone();
                tokio::spawn(async move {
                    let mut buf = Vec::new();
                    let mut tmp = [0u8; 2048];
                    // read headers, then the declared body
                    loop {
                        let n = sock.read(&mut tmp).await.unwrap_or(0);
                        if n == 0 {
                            break;
                        }
                        buf.extend_from_slice(&tmp[..n]);
                        let text = String::from_utf8_lossy(&buf).to_string();
                        if let Some(h) = text.find("\r\n\r\n") {
                            let len = text[..h]
                                .lines()
                                .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0)))
                                .unwrap_or(0);
                            if buf.len() >= h + 4 + len {
                                break;
                            }
                        }
                    }
                    let text = String::from_utf8_lossy(&buf).to_string();
                    seen.lock().unwrap().push(text.lines().next().unwrap_or("").to_string());
                    let reply = format!(
                        "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = sock.write_all(reply.as_bytes()).await;
                });
            }
        });
        (base, seen)
    }

    async fn test_db() -> (Db, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(&dir.path().join("t.db"), dir.path()).await.unwrap();
        (db, dir)
    }

    /// An address nothing listens on, so connecting fails at once.
    async fn dead_server() -> String {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        drop(l);
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn server_refusal_blocks_activation_and_saves_nothing() {
        let keys = test_keys();
        let (base, seen) = mock_server(403, r#"{"error":"Device limit reached (maximum 2 PCs)."}"#).await;
        let (db, _d) = test_db().await;
        let err = activate_license_with(&db, &sign(&keys, "a@b.co"), &keys.public_hex, &base).await.unwrap_err();
        assert!(err.contains("Device limit"), "{err}");
        assert!(!get_status_with(&db, &keys.public_hex).await.is_licensed);
        assert!(seen.lock().unwrap()[0].starts_with("POST /api/license/activate"));
    }

    #[tokio::test]
    async fn accepted_activation_saves_the_license_and_sends_a_hashed_machine_id() {
        let keys = test_keys();
        let (base, _seen) = mock_server(200, r#"{"success":true}"#).await;
        let (db, _d) = test_db().await;
        let st = activate_license_with(&db, &format!("  {}  ", sign(&keys, "me@x.co")), &keys.public_hex, &base).await.unwrap();
        assert!(st.is_licensed && st.license_email.as_deref() == Some("me@x.co"));
        assert!(db.get_setting("license_checked_at").await.is_some());
        let id = machine_id(&db).await;
        assert_eq!(id.len(), 64, "sha-256 hex");
        assert_eq!(id, machine_id(&db).await, "stable between calls");
    }

    #[tokio::test]
    async fn forged_key_never_reaches_the_server() {
        let keys = test_keys();
        let other = test_keys();
        let (base, seen) = mock_server(200, "{}").await;
        let (db, _d) = test_db().await;
        assert!(activate_license_with(&db, &sign(&other, "evil@x.co"), &keys.public_hex, &base).await.is_err());
        assert!(seen.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn offline_activation_still_works() {
        let keys = test_keys();
        let (db, _d) = test_db().await;
        let st = activate_license_with(&db, &sign(&keys, "off@x.co"), &keys.public_hex, &dead_server().await).await.unwrap();
        assert!(st.is_licensed, "no internet must not stop a genuine key");
    }

    #[tokio::test]
    async fn recheck_removes_a_refunded_license_and_explains_why() {
        let keys = test_keys();
        let (db, _d) = test_db().await;
        activate_license_with(&db, &sign(&keys, "r@x.co"), &keys.public_hex, &dead_server().await).await.unwrap();
        let (base, _s) = mock_server(403, r#"{"error":"This license was refunded and is no longer valid."}"#).await;
        assert!(recheck_with(&db, &keys.public_hex, &base).await);
        let st = get_status_with(&db, &keys.public_hex).await;
        assert!(!st.is_licensed);
        assert!(st.license_notice.unwrap().contains("refunded"));
    }

    #[tokio::test]
    async fn recheck_keeps_the_license_when_offline_or_the_server_errors() {
        let keys = test_keys();
        let (db, _d) = test_db().await;
        activate_license_with(&db, &sign(&keys, "k@x.co"), &keys.public_hex, &dead_server().await).await.unwrap();
        assert!(!recheck_with(&db, &keys.public_hex, &dead_server().await).await);
        for code in [500u16, 502, 429, 404, 400] {
            let (base, _s) = mock_server(code, r#"{"error":"x"}"#).await;
            assert!(!recheck_with(&db, &keys.public_hex, &base).await, "HTTP {code} must not remove a license");
        }
        assert!(get_status_with(&db, &keys.public_hex).await.is_licensed);
    }

    // ---- bypass attempts: every one of these must leave the app in free (limited) mode --------------------------

    fn test_engine() -> flowget_engine::Engine {
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        flowget_engine::Engine::new(flowget_engine::EngineConfig::new(std::env::temp_dir()), tx)
    }

    /// What `lib.rs` does at start-up with whatever the database says.
    fn apply_saved_settings(engine: &flowget_engine::Engine, conns: &str, turbo: &str) {
        if let Ok(v) = conns.parse::<u32>() {
            engine.set_default_connections(v);
        }
        engine.set_turbo_mode(turbo == "1");
    }

    #[tokio::test]
    async fn editing_the_database_cannot_unlock_turbo_or_32_connections() {
        let keys = test_keys();
        let (db, _d) = test_db().await;
        db.set_setting("turbo_mode", "1").await.unwrap();
        db.set_setting("default_connections", "32").await.unwrap();
        let engine = test_engine();
        let st = enforce_with(&db, &engine, &keys.public_hex).await; // first, as in lib.rs
        apply_saved_settings(&engine, "32", "1");
        assert!(!st.is_licensed);
        assert!(!engine.turbo_mode(), "tampered turbo_mode=1 must not switch Turbo on");
        assert_eq!(engine.default_connections(), 2);
        assert_eq!(engine.connection_cap(), 2);
    }

    #[tokio::test]
    async fn a_forged_key_written_straight_into_the_database_unlocks_nothing() {
        let keys = test_keys();
        let attacker = test_keys();
        let (db, _d) = test_db().await;
        // Bypasses activate_license entirely: the attacker edits the settings table himself.
        db.set_setting("license_key", &sign(&attacker, "pirate@x.co")).await.unwrap();
        db.set_setting("license_email", "pirate@x.co").await.unwrap();
        db.set_setting("license_tier", "lifetime").await.unwrap();
        let engine = test_engine();
        let st = enforce_with(&db, &engine, &keys.public_hex).await;
        assert!(!st.is_licensed && st.license_key.is_none());
        assert!(!st.turbo_mode_allowed && !st.media_download_allowed);
        assert_eq!(engine.connection_cap(), 2);
    }

    #[tokio::test]
    async fn garbage_and_tampered_license_values_in_the_database_are_free_mode() {
        let keys = test_keys();
        let good = sign(&keys, "ok@x.co");
        let mut parts: Vec<String> = good.split('.').map(str::to_string).collect();
        // flip one character of the signature, and one of the payload
        let mut sig = parts[2].clone().into_bytes();
        sig[5] = if sig[5] == b'A' { b'B' } else { b'A' };
        parts[2] = String::from_utf8(sig).unwrap();
        let bad_sig = parts.join(".");
        let mut p2: Vec<String> = good.split('.').map(str::to_string).collect();
        let mut pl = p2[1].clone().into_bytes();
        pl[3] = if pl[3] == b'A' { b'B' } else { b'A' };
        p2[1] = String::from_utf8(pl).unwrap();
        let bad_payload = p2.join(".");
        let upgraded = {
            // the attacker re-encodes the payload with a better tier but keeps the old signature
            let pl = URL_SAFE_NO_PAD.encode(r#"{"keyId":"FG-TEST","email":"ok@x.co","tier":"enterprise","maxDevices":999,"issuedAt":1}"#);
            format!("FG1.{pl}.{}", good.split('.').nth(2).unwrap())
        };
        for bad in [bad_sig, bad_payload, upgraded, "FG1..".into(), "FG1".into(), "x.y.z".into(), "FG1.a.b.c".into(), " ".into(), "\0".into(), "A".repeat(100_000)] {
            let (db, _d) = test_db().await;
            db.set_setting("license_key", &bad).await.unwrap();
            let st = get_status_with(&db, &keys.public_hex).await;
            assert!(!st.is_licensed, "accepted {:?}", bad.chars().take(30).collect::<String>());
        }
    }

    #[tokio::test]
    async fn a_refund_ends_pro_limits_in_the_engine_at_once() {
        let keys = test_keys();
        let (db, _d) = test_db().await;
        let engine = test_engine();
        activate_license_with(&db, &sign(&keys, "r@x.co"), &keys.public_hex, &dead_server().await).await.unwrap();
        enforce_with(&db, &engine, &keys.public_hex).await;
        assert_eq!(engine.connection_cap(), 32);
        engine.set_turbo_mode(true);
        assert!(engine.turbo_mode());
        let (base, _s) = mock_server(403, r#"{"error":"refunded"}"#).await;
        assert!(recheck_with(&db, &keys.public_hex, &base).await);
        enforce_with(&db, &engine, &keys.public_hex).await;
        assert_eq!(engine.connection_cap(), 2);
        assert!(!engine.turbo_mode(), "Turbo must stop when the license is revoked");
    }

    #[tokio::test]
    async fn a_valid_license_unlocks_the_limits() {
        let keys = test_keys();
        let (db, _d) = test_db().await;
        let engine = test_engine();
        activate_license_with(&db, &sign(&keys, "v@x.co"), &keys.public_hex, &dead_server().await).await.unwrap();
        let st = enforce_with(&db, &engine, &keys.public_hex).await;
        assert!(st.is_licensed && st.turbo_mode_allowed && st.media_download_allowed);
        assert_eq!(engine.connection_cap(), 32);
        engine.set_turbo_mode(true);
        assert!(engine.turbo_mode());
    }

    // ---- grace period and the sealed "last confirmed" stamp --------------------------------------------------

    const DAY: u64 = 86400;

    /// Writes a genuine (correctly sealed) stamp for `ts`, as the app itself would have at that time.
    async fn stamp_at(db: &Db, key: &str, ts: u64) {
        let id = machine_id(db).await;
        db.set_setting("license_checked_at", &seal_stamp(&id, key, ts)).await.unwrap();
    }

    async fn activated_offline(keys: &TestKeys, email: &str) -> (Db, tempfile::TempDir, String) {
        let (db, d) = test_db().await;
        let key = sign(keys, email);
        activate_license_with(&db, &key, &keys.public_hex, &dead_server().await).await.unwrap();
        (db, d, key)
    }

    #[tokio::test]
    async fn a_key_nobody_confirmed_stops_working_after_the_grace_period() {
        let keys = test_keys();
        let (db, _d, key) = activated_offline(&keys, "g@x.co").await;
        let now = current_timestamp();
        stamp_at(&db, &key, now - (LICENSE_GRACE_SECS - DAY)).await; // 1 day of grace left
        assert!(get_status_with(&db, &keys.public_hex).await.is_licensed);
        stamp_at(&db, &key, now - (LICENSE_GRACE_SECS + DAY)).await; // 1 day over
        let st = get_status_with(&db, &keys.public_hex).await;
        assert!(!st.is_licensed && !st.turbo_mode_allowed && st.max_connections == 2);
        assert!(st.license_notice.unwrap().contains("internet"), "the user is told what to do");
        assert!(db.get_setting("license_key").await.is_some_and(|k| k == key), "key kept, so going online fixes it");
    }

    #[tokio::test]
    async fn going_online_brings_an_expired_license_back() {
        let keys = test_keys();
        let (db, _d, key) = activated_offline(&keys, "b@x.co").await;
        stamp_at(&db, &key, current_timestamp() - 40 * DAY).await;
        assert!(!get_status_with(&db, &keys.public_hex).await.is_licensed);
        let (base, _s) = mock_server(200, r#"{"success":true}"#).await;
        assert!(recheck_with(&db, &keys.public_hex, &base).await, "state changed, so the UI refreshes");
        let st = get_status_with(&db, &keys.public_hex).await;
        assert!(st.is_licensed && st.license_notice.is_none());
    }

    #[tokio::test]
    async fn a_forged_key_that_activates_offline_dies_at_the_first_online_check() {
        let keys = test_keys();
        let (db, _d, key) = activated_offline(&keys, "pirate@x.co").await;
        assert!(get_status_with(&db, &keys.public_hex).await.is_licensed, "works offline for now");
        let (base, _s) = mock_server(403, r#"{"error":"This license key was not issued by FlowGet.","code":"unknown_key"}"#).await;
        assert!(recheck_with(&db, &keys.public_hex, &base).await);
        let st = get_status_with(&db, &keys.public_hex).await;
        assert!(!st.is_licensed);
        assert!(st.license_notice.unwrap().contains("not issued"));
        assert_eq!(db.get_setting("license_key").await.as_deref(), Some(key.as_str()), "kept for automatic recovery");
    }

    #[tokio::test]
    async fn if_the_servers_records_come_back_an_unknown_key_license_recovers_by_itself() {
        let keys = test_keys();
        let (db, _d, _key) = activated_offline(&keys, "r@x.co").await;
        let (lost, _s1) = mock_server(403, r#"{"error":"not issued","code":"unknown_key"}"#).await;
        assert!(recheck_with(&db, &keys.public_hex, &lost).await);
        assert!(!get_status_with(&db, &keys.public_hex).await.is_licensed);
        let (restored, _s2) = mock_server(200, r#"{"success":true}"#).await;
        assert!(recheck_with(&db, &keys.public_hex, &restored).await);
        assert!(get_status_with(&db, &keys.public_hex).await.is_licensed);
    }

    #[tokio::test]
    async fn an_unknown_key_is_refused_at_activation_and_saves_nothing() {
        let keys = test_keys();
        let (db, _d) = test_db().await;
        let (base, _s) = mock_server(403, r#"{"error":"This license key was not issued by FlowGet.","code":"unknown_key"}"#).await;
        let err = activate_license_with(&db, &sign(&keys, "p@x.co"), &keys.public_hex, &base).await.unwrap_err();
        assert!(err.contains("not issued"));
        assert!(db.get_setting("license_key").await.is_none());
    }

    #[tokio::test]
    async fn editing_the_stamp_in_the_database_does_not_extend_the_grace_period() {
        let keys = test_keys();
        let (db, _d, key) = activated_offline(&keys, "t@x.co").await;
        let now = current_timestamp();
        let id = machine_id(&db).await;
        let old = now - (LICENSE_GRACE_SECS + 5 * DAY);
        stamp_at(&db, &key, old).await;
        let sealed = db.get_setting("license_checked_at").await.unwrap();
        let tag = sealed.split_once('.').unwrap().1.to_string();
        let other_machine = seal_stamp("some-other-pc", &key, now);
        let other_key = seal_stamp(&id, &sign(&keys, "other@x.co"), now);
        let future = seal_stamp(&id, &key, now + 2 * DAY); // genuine seal, but from the future (clock games)
        for (why, forged) in [
            ("plain number", now.to_string()),
            ("old seal, new time", format!("{now}.{tag}")),
            ("seal copied from another PC", other_machine),
            ("seal made for another key", other_key),
            ("stamp from the future", future),
            ("empty", String::new()),
            ("garbage", "x.y".to_string()),
            ("non-ascii", format!("{now}.{}", "é".repeat(32))),
            ("huge", "9".repeat(100_000)),
        ] {
            db.set_setting("license_checked_at", &forged).await.unwrap();
            assert!(!get_status_with(&db, &keys.public_hex).await.is_licensed, "accepted: {why}");
        }
    }

    #[tokio::test]
    async fn the_engine_loses_pro_limits_when_the_grace_period_runs_out() {
        let keys = test_keys();
        let (db, _d, key) = activated_offline(&keys, "e@x.co").await;
        let engine = test_engine();
        enforce_with(&db, &engine, &keys.public_hex).await;
        assert_eq!(engine.connection_cap(), 32);
        stamp_at(&db, &key, current_timestamp() - (LICENSE_GRACE_SECS + DAY)).await;
        enforce_with(&db, &engine, &keys.public_hex).await;
        assert_eq!(engine.connection_cap(), 2);
        assert!(!engine.turbo_mode());
    }

    #[test]
    fn license_bookkeeping_and_limit_settings_are_protected_from_the_generic_writer() {
        for k in ["license_key", "License_Key", " license_tier ", "LICENSE_EMAIL", "license_notice", "license_checked_at",
                  "machine_id", "trial_started_at", "turbo_mode", "TURBO_MODE", "default_connections"] {
            assert!(is_protected_setting(k), "{k}");
        }
        for k in ["theme", "language", "proxy", "download_dir", "auto_extract", ""] {
            assert!(!is_protected_setting(k), "{k}");
        }
    }

    #[tokio::test]
    async fn deactivate_frees_the_server_slot_and_works_offline() {
        let keys = test_keys();
        let (db, _d) = test_db().await;
        let (base, seen) = mock_server(200, r#"{"success":true}"#).await;
        activate_license_with(&db, &sign(&keys, "d@x.co"), &keys.public_hex, &base).await.unwrap();
        let st = deactivate_license_with(&db, &keys.public_hex, &base).await.unwrap();
        assert!(!st.is_licensed);
        assert!(seen.lock().unwrap().iter().any(|l| l.starts_with("POST /api/license/deactivate")));

        activate_license_with(&db, &sign(&keys, "d@x.co"), &keys.public_hex, &base).await.unwrap();
        let st = deactivate_license_with(&db, &keys.public_hex, &dead_server().await).await.unwrap();
        assert!(!st.is_licensed, "offline deactivation still clears the local license");
    }
}
