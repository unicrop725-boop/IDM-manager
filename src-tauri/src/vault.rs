//! Passwords for authenticated downloads live in the Windows Credential Manager ("Credential Vault"),
//! not in the database file. The database keeps only the user name; the secret is looked up by download id.
//!
//! If the vault cannot be used (not Windows, or the call fails) the caller keeps the secret where it was,
//! so a password is never lost, only stored less safely.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

/// Last secret written per download, so the once-a-second progress saves do not rewrite the vault.
fn written() -> &'static Mutex<HashMap<String, String>> {
    static W: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    W.get_or_init(|| Mutex::new(HashMap::new()))
}

fn target(id: &str) -> String {
    format!("FlowGet/download/{id}")
}

/// Save `secret` for download `id`. `Ok` means it is safely in the vault and can be removed from the database.
pub fn store(id: &str, secret: &str) -> Result<(), String> {
    if written().lock().map(|w| w.get(id).map(String::as_str) == Some(secret)).unwrap_or(false) {
        return Ok(());
    }
    imp::write(&target(id), secret)?;
    if let Ok(mut w) = written().lock() {
        w.insert(id.to_string(), secret.to_string());
    }
    Ok(())
}

/// The saved secret for download `id`, if any.
pub fn load(id: &str) -> Option<String> {
    imp::read(&target(id))
}

/// Forget the secret of a removed download.
pub fn delete(id: &str) {
    if let Ok(mut w) = written().lock() {
        w.remove(id);
    }
    imp::delete(&target(id));
}

#[cfg(windows)]
mod imp {
    use std::ptr;
    use windows_sys::Win32::Foundation::GetLastError;
    use windows_sys::Win32::Security::Credentials::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    };

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn write(target: &str, secret: &str) -> Result<(), String> {
        let mut name = wide(target);
        let mut user = wide("FlowGet");
        let mut blob = secret.as_bytes().to_vec();
        let cred = CREDENTIALW {
            Flags: 0,
            Type: CRED_TYPE_GENERIC,
            TargetName: name.as_mut_ptr(),
            Comment: ptr::null_mut(),
            LastWritten: unsafe { std::mem::zeroed() },
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            AttributeCount: 0,
            Attributes: ptr::null_mut(),
            TargetAlias: ptr::null_mut(),
            UserName: user.as_mut_ptr(),
        };
        // SAFETY: `cred` points at buffers that outlive the call; Windows copies the data.
        let ok = unsafe { CredWriteW(&cred, 0) };
        if ok == 0 {
            return Err(format!("Windows Credential Manager refused the password (error {})", unsafe { GetLastError() }));
        }
        Ok(())
    }

    pub fn read(target: &str) -> Option<String> {
        let name = wide(target);
        let mut out: *mut CREDENTIALW = ptr::null_mut();
        // SAFETY: on success `out` is a buffer owned by Windows that we free with CredFree.
        unsafe {
            if CredReadW(name.as_ptr(), CRED_TYPE_GENERIC, 0, &mut out) == 0 || out.is_null() {
                return None;
            }
            let c = &*out;
            let bytes = if c.CredentialBlob.is_null() {
                &[][..]
            } else {
                std::slice::from_raw_parts(c.CredentialBlob, c.CredentialBlobSize as usize)
            };
            let secret = String::from_utf8_lossy(bytes).into_owned();
            CredFree(out as *const _);
            Some(secret)
        }
    }

    pub fn delete(target: &str) {
        let name = wide(target);
        // SAFETY: plain call with a NUL-terminated name. A missing entry is fine.
        unsafe {
            CredDeleteW(name.as_ptr(), CRED_TYPE_GENERIC, 0);
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn write(_target: &str, _secret: &str) -> Result<(), String> {
        Err("no credential vault on this system".into())
    }
    pub fn read(_target: &str) -> Option<String> {
        None
    }
    pub fn delete(_target: &str) {}
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn password_round_trips_through_the_windows_vault() {
        let id = "test-vault-roundtrip";
        delete(id);
        assert_eq!(load(id), None);
        store(id, "p@ss wörd ✓").unwrap();
        assert_eq!(load(id).as_deref(), Some("p@ss wörd ✓"));
        store(id, "changed").unwrap();
        assert_eq!(load(id).as_deref(), Some("changed"));
        delete(id);
        assert_eq!(load(id), None);
    }
}
