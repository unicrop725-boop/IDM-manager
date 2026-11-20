//! Optional checksum verification (MD5 / SHA-1 / SHA-256) of the finished file.

use md5::Md5;
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use sha2::{Digest, Sha256};
use std::fmt;
use std::io::{self, Read};
use std::path::Path;
use tokio_util::sync::CancellationToken;

use crate::error::EngineError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HashAlgo {
    Md5,
    Sha1,
    Sha256,
}

impl fmt::Display for HashAlgo {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            HashAlgo::Md5 => "MD5",
            HashAlgo::Sha1 => "SHA-1",
            HashAlgo::Sha256 => "SHA-256",
        })
    }
}

/// An expected checksum supplied by the user.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Checksum {
    pub algo: HashAlgo,
    /// Lower-case hex.
    pub hex: String,
}

impl Checksum {
    /// Parse `"sha256:<hex>"`, `"md5:<hex>"`, `"sha1:<hex>"`, or a bare hex string whose
    /// algorithm is guessed from its length (32 = MD5, 40 = SHA-1, 64 = SHA-256).
    pub fn parse(input: &str) -> Result<Self, EngineError> {
        let input = input.trim();
        let (algo_hint, hex) = match input.split_once(':') {
            Some((a, h)) => (Some(a.trim().to_ascii_lowercase()), h.trim()),
            None => (None, input),
        };
        let hex = hex.to_ascii_lowercase();
        if hex.is_empty() || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(EngineError::InvalidOption(
                "The checksum must be a hexadecimal string (digits 0-9 and letters a-f).".into(),
            ));
        }
        let by_len = match hex.len() {
            32 => Some(HashAlgo::Md5),
            40 => Some(HashAlgo::Sha1),
            64 => Some(HashAlgo::Sha256),
            _ => None,
        };
        let algo = match algo_hint.as_deref() {
            Some("md5") => HashAlgo::Md5,
            Some("sha1") | Some("sha-1") => HashAlgo::Sha1,
            Some("sha256") | Some("sha-256") => HashAlgo::Sha256,
            Some(other) => {
                return Err(EngineError::InvalidOption(format!(
                    "Unknown checksum type \"{other}\". Use md5, sha1 or sha256."
                )))
            }
            None => by_len.ok_or_else(|| {
                EngineError::InvalidOption(
                    "Couldn't tell what kind of checksum this is. Use md5:..., sha1:... or sha256:...".into(),
                )
            })?,
        };
        let expected_len = match algo {
            HashAlgo::Md5 => 32,
            HashAlgo::Sha1 => 40,
            HashAlgo::Sha256 => 64,
        };
        if hex.len() != expected_len {
            return Err(EngineError::InvalidOption(format!(
                "A {algo} checksum has {expected_len} characters, but this one has {}.",
                hex.len()
            )));
        }
        Ok(Self { algo, hex })
    }
}

fn run_hasher<D: Digest>(path: &Path, cancel: &CancellationToken) -> io::Result<Option<String>> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = D::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        if cancel.is_cancelled() {
            return Ok(None);
        }
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(Some(hex::encode(hasher.finalize())))
}

/// Hash a file (blocking; call from `spawn_blocking`). Returns `None` if cancelled part-way.
pub fn hash_file(path: &Path, algo: HashAlgo, cancel: &CancellationToken) -> io::Result<Option<String>> {
    match algo {
        HashAlgo::Md5 => run_hasher::<Md5>(path, cancel),
        HashAlgo::Sha1 => run_hasher::<Sha1>(path, cancel),
        HashAlgo::Sha256 => run_hasher::<Sha256>(path, cancel),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ABC_MD5: &str = "900150983cd24fb0d6963f7d28e17f72";
    const ABC_SHA1: &str = "a9993e364706816aba3e25717850c26c9cd0d89d";
    const ABC_SHA256: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

    #[test]
    fn hashes_match_known_vectors() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("abc.txt");
        std::fs::write(&p, b"abc").unwrap();
        let c = CancellationToken::new();
        assert_eq!(hash_file(&p, HashAlgo::Md5, &c).unwrap().unwrap(), ABC_MD5);
        assert_eq!(hash_file(&p, HashAlgo::Sha1, &c).unwrap().unwrap(), ABC_SHA1);
        assert_eq!(hash_file(&p, HashAlgo::Sha256, &c).unwrap().unwrap(), ABC_SHA256);
    }

    #[test]
    fn cancelled_hash_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("abc.txt");
        std::fs::write(&p, b"abc").unwrap();
        let c = CancellationToken::new();
        c.cancel();
        assert_eq!(hash_file(&p, HashAlgo::Sha256, &c).unwrap(), None);
    }

    #[test]
    fn parse_guesses_algorithm_from_length() {
        assert_eq!(Checksum::parse(ABC_MD5).unwrap().algo, HashAlgo::Md5);
        assert_eq!(Checksum::parse(ABC_SHA1).unwrap().algo, HashAlgo::Sha1);
        assert_eq!(Checksum::parse(&ABC_SHA256.to_uppercase()).unwrap().hex, ABC_SHA256);
    }

    #[test]
    fn parse_with_prefix() {
        let c = Checksum::parse(&format!("SHA256:{ABC_SHA256}")).unwrap();
        assert_eq!(c.algo, HashAlgo::Sha256);
        let c = Checksum::parse(&format!("md5: {ABC_MD5} ")).unwrap();
        assert_eq!(c.algo, HashAlgo::Md5);
    }

    #[test]
    fn parse_rejects_bad_input() {
        assert!(Checksum::parse("").is_err());
        assert!(Checksum::parse("not hex!").is_err());
        assert!(Checksum::parse("abcd").is_err()); // unknown length
        assert!(Checksum::parse(&format!("md5:{ABC_SHA1}")).is_err()); // prefix/length mismatch
        assert!(Checksum::parse(&format!("crc32:{ABC_MD5}")).is_err());
    }
}
