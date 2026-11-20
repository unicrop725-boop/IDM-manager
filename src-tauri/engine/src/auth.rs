//! HTTP authentication: Basic and Digest (RFC 7616 / RFC 2617).
//!
//! Flow: the first request goes out without credentials. If the server answers 401 with a
//! `WWW-Authenticate` challenge, [`AuthManager::on_challenge`] learns which scheme to use, and
//! every later request (on every connection) carries a matching `Authorization` header.

use base64::Engine as _;
use md5::Md5;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

#[derive(Debug, Clone)]
pub struct Credentials {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DigestHash {
    Md5,
    Sha256,
}

impl DigestHash {
    fn hex(self, data: &str) -> String {
        match self {
            DigestHash::Md5 => hex::encode(Md5::digest(data.as_bytes())),
            DigestHash::Sha256 => hex::encode(Sha256::digest(data.as_bytes())),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DigestChallenge {
    realm: String,
    nonce: String,
    opaque: Option<String>,
    /// Algorithm token exactly as the server sent it (echoed back in the header).
    algorithm: String,
    hash: DigestHash,
    sess: bool,
    qop_auth: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Challenge {
    Basic,
    Digest(DigestChallenge),
}

/// Parse `key=value, key="quoted value", ...` parameters.
fn parse_params(s: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        while i < chars.len() && (chars[i] == ',' || chars[i].is_whitespace()) {
            i += 1;
        }
        let ks = i;
        while i < chars.len() && chars[i] != '=' && chars[i] != ',' {
            i += 1;
        }
        let key: String = chars[ks..i].iter().collect::<String>().trim().to_ascii_lowercase();
        if i >= chars.len() || chars[i] != '=' {
            continue;
        }
        i += 1; // '='
        let value = if i < chars.len() && chars[i] == '"' {
            i += 1;
            let mut v = String::new();
            while i < chars.len() && chars[i] != '"' {
                if chars[i] == '\\' && i + 1 < chars.len() {
                    i += 1;
                }
                v.push(chars[i]);
                i += 1;
            }
            i += 1; // closing quote
            v
        } else {
            let vs = i;
            while i < chars.len() && chars[i] != ',' {
                i += 1;
            }
            chars[vs..i].iter().collect::<String>().trim().to_string()
        };
        if !key.is_empty() {
            map.insert(key, value);
        }
    }
    map
}

/// Parse one `WWW-Authenticate` header value.
pub fn parse_challenge(header: &str) -> Option<Challenge> {
    let header = header.trim();
    let (scheme, rest) = header.split_once(char::is_whitespace).unwrap_or((header, ""));
    match scheme.to_ascii_lowercase().as_str() {
        "basic" => Some(Challenge::Basic),
        "digest" => {
            let p = parse_params(rest);
            let nonce = p.get("nonce")?.clone();
            let realm = p.get("realm").cloned().unwrap_or_default();
            let algorithm = p.get("algorithm").cloned().unwrap_or_else(|| "MD5".to_string());
            let upper = algorithm.to_ascii_uppercase();
            let sess = upper.ends_with("-SESS");
            let hash = match upper.trim_end_matches("-SESS") {
                "MD5" => DigestHash::Md5,
                "SHA-256" => DigestHash::Sha256,
                _ => return None, // e.g. SHA-512-256: not supported
            };
            let qop_auth = p
                .get("qop")
                .map(|q| q.split(',').any(|t| t.trim().eq_ignore_ascii_case("auth")))
                .unwrap_or(false);
            Some(Challenge::Digest(DigestChallenge {
                realm,
                nonce,
                opaque: p.get("opaque").cloned(),
                algorithm,
                hash,
                sess,
                qop_auth,
            }))
        }
        _ => None,
    }
}

/// Compute the Digest `response` value.
#[allow(clippy::too_many_arguments)]
fn digest_response(
    c: &DigestChallenge,
    user: &str,
    pass: &str,
    method: &str,
    uri: &str,
    nc: &str,
    cnonce: &str,
) -> String {
    let h = c.hash;
    let mut ha1 = h.hex(&format!("{user}:{}:{pass}", c.realm));
    if c.sess {
        ha1 = h.hex(&format!("{ha1}:{}:{cnonce}", c.nonce));
    }
    let ha2 = h.hex(&format!("{method}:{uri}"));
    if c.qop_auth {
        h.hex(&format!("{ha1}:{}:{nc}:{cnonce}:auth:{ha2}", c.nonce))
    } else {
        h.hex(&format!("{ha1}:{}:{ha2}", c.nonce))
    }
}

#[derive(Debug, Clone)]
enum AuthState {
    /// Nothing negotiated yet: send no `Authorization` header.
    None,
    Basic,
    Digest(DigestChallenge),
}

/// Shared by all connections of one download.
pub struct AuthManager {
    creds: Option<Credentials>,
    state: Mutex<AuthState>,
    /// Digest nonce-use counter; must increase for each request with the same nonce.
    nc: AtomicU32,
}

impl AuthManager {
    pub fn new(creds: Option<Credentials>) -> Self {
        Self { creds, state: Mutex::new(AuthState::None), nc: AtomicU32::new(0) }
    }

    pub fn has_credentials(&self) -> bool {
        self.creds.is_some()
    }

    /// The `Authorization` header value for a request, if a scheme has been negotiated.
    /// `uri` is the request target (path + query).
    pub fn authorization(&self, method: &str, uri: &str) -> Option<String> {
        let creds = self.creds.as_ref()?;
        match &*self.state.lock().unwrap() {
            AuthState::None => None,
            AuthState::Basic => {
                let raw = format!("{}:{}", creds.username, creds.password);
                Some(format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(raw)))
            }
            AuthState::Digest(c) => {
                let nc = format!("{:08x}", self.nc.fetch_add(1, Ordering::Relaxed) + 1);
                let cnonce = format!("{:016x}", rand::random::<u64>());
                let response =
                    digest_response(c, &creds.username, &creds.password, method, uri, &nc, &cnonce);
                let mut h = format!(
                    "Digest username=\"{}\", realm=\"{}\", nonce=\"{}\", uri=\"{}\", algorithm={}, response=\"{}\"",
                    creds.username, c.realm, c.nonce, uri, c.algorithm, response
                );
                if c.qop_auth {
                    h.push_str(&format!(", qop=auth, nc={nc}, cnonce=\"{cnonce}\""));
                }
                if let Some(o) = &c.opaque {
                    h.push_str(&format!(", opaque=\"{o}\""));
                }
                Some(h)
            }
        }
    }

    /// Handle a 401 response. Returns `true` if the request should be retried with new
    /// credentials; `false` if we have none or the server rejected the ones we already sent.
    pub fn on_challenge(&self, www_authenticate: &[String]) -> bool {
        if self.creds.is_none() {
            return false;
        }
        let challenges: Vec<Challenge> =
            www_authenticate.iter().filter_map(|h| parse_challenge(h)).collect();
        // Prefer Digest (the password never travels in the clear) over Basic.
        let chosen = challenges
            .iter()
            .find(|c| matches!(c, Challenge::Digest(_)))
            .or_else(|| challenges.iter().find(|c| matches!(c, Challenge::Basic)));
        let mut state = self.state.lock().unwrap();
        match (chosen, &*state) {
            (None, _) => false,
            // Basic was already sent and rejected: wrong password.
            (Some(Challenge::Basic), AuthState::Basic) => false,
            (Some(Challenge::Basic), _) => {
                *state = AuthState::Basic;
                true
            }
            // Same nonce again: the server rejected our credentials. A new nonce means the old
            // one went stale, so retrying with the new one is worthwhile.
            (Some(Challenge::Digest(new)), AuthState::Digest(old)) if new.nonce == old.nonce => false,
            (Some(Challenge::Digest(new)), _) => {
                *state = AuthState::Digest(new.clone());
                self.nc.store(0, Ordering::Relaxed);
                true
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc2617_example_vector() {
        // RFC 2617 section 3.5.
        let hdr = r#"Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41""#;
        let Some(Challenge::Digest(c)) = parse_challenge(hdr) else { panic!("not digest") };
        assert!(c.qop_auth);
        let resp = digest_response(
            &c,
            "Mufasa",
            "Circle Of Life",
            "GET",
            "/dir/index.html",
            "00000001",
            "0a4f113b",
        );
        assert_eq!(resp, "6629fae49393a05397450978507c4ef1");
    }

    #[test]
    fn rfc7616_sha256_example_vector() {
        // RFC 7616 section 3.9.1 (SHA-256, no userhash).
        let hdr = r#"Digest realm="http-auth@example.org", qop="auth, auth-int", algorithm=SHA-256, nonce="7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v", opaque="FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS""#;
        let Some(Challenge::Digest(c)) = parse_challenge(hdr) else { panic!("not digest") };
        assert_eq!(c.hash, DigestHash::Sha256);
        let resp = digest_response(
            &c,
            "Mufasa",
            "Circle of Life",
            "GET",
            "/dir/index.html",
            "00000001",
            "f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ",
        );
        assert_eq!(resp, "753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1");
    }

    #[test]
    fn parses_basic_and_ignores_unknown_schemes() {
        assert_eq!(parse_challenge(r#"Basic realm="x""#), Some(Challenge::Basic));
        assert_eq!(parse_challenge("Negotiate"), None);
        // Unsupported digest algorithm is skipped rather than mis-answered.
        assert_eq!(parse_challenge(r#"Digest realm="x", nonce="n", algorithm=SHA-512-256"#), None);
    }

    #[test]
    fn basic_header_is_base64_of_user_colon_pass() {
        let a = AuthManager::new(Some(Credentials { username: "aladdin".into(), password: "open sesame".into() }));
        assert_eq!(a.authorization("GET", "/"), None); // nothing sent before a challenge
        assert!(a.on_challenge(&[r#"Basic realm="x""#.to_string()]));
        assert_eq!(a.authorization("GET", "/").as_deref(), Some("Basic YWxhZGRpbjpvcGVuIHNlc2FtZQ=="));
        // Server rejects the same Basic credentials again: do not loop.
        assert!(!a.on_challenge(&[r#"Basic realm="x""#.to_string()]));
    }

    #[test]
    fn digest_header_contains_expected_fields_and_counts_up() {
        let a = AuthManager::new(Some(Credentials { username: "u".into(), password: "p".into() }));
        let ch = r#"Digest realm="r", nonce="n1", qop="auth", opaque="o""#.to_string();
        assert!(a.on_challenge(&[ch.clone()]));
        let h1 = a.authorization("GET", "/f?x=1").unwrap();
        let h2 = a.authorization("GET", "/f?x=1").unwrap();
        assert!(h1.starts_with("Digest username=\"u\""));
        assert!(h1.contains("uri=\"/f?x=1\"") && h1.contains("qop=auth") && h1.contains("opaque=\"o\""));
        assert!(h1.contains("nc=00000001") && h2.contains("nc=00000002"));
        // Same nonce challenged again = bad credentials.
        assert!(!a.on_challenge(&[ch]));
        // New nonce (stale) = retry, counter restarts.
        assert!(a.on_challenge(&[r#"Digest realm="r", nonce="n2", qop="auth", stale=true"#.to_string()]));
        assert!(a.authorization("GET", "/").unwrap().contains("nc=00000001"));
    }

    #[test]
    fn no_credentials_means_no_retry() {
        let a = AuthManager::new(None);
        assert!(!a.on_challenge(&[r#"Basic realm="x""#.to_string()]));
        assert_eq!(a.authorization("GET", "/"), None);
    }

    #[test]
    fn digest_is_preferred_over_basic() {
        let a = AuthManager::new(Some(Credentials { username: "u".into(), password: "p".into() }));
        assert!(a.on_challenge(&[
            r#"Basic realm="x""#.to_string(),
            r#"Digest realm="x", nonce="abc""#.to_string()
        ]));
        assert!(a.authorization("GET", "/").unwrap().starts_with("Digest "));
    }
}
