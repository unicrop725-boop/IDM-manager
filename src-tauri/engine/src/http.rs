//! HTTP plumbing: client construction, redirects (max 10), cookies, custom headers, referer,
//! user-agent and Basic/Digest authentication.

use std::net::IpAddr;
use std::sync::atomic::{AtomicU32, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use reqwest::cookie::Jar;
use reqwest::header::{HeaderName, HeaderValue, ACCEPT_ENCODING, AUTHORIZATION, REFERER, WWW_AUTHENTICATE};
use reqwest::{redirect, Client, ClientBuilder, Method, RequestBuilder, Response};
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;
use url::Url;

use crate::auth::{AuthManager, Credentials};
use crate::dns::{CachedResolver, DnsCache, Family};
use crate::error::EngineError;

pub const MAX_REDIRECTS: usize = 10;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// How long we wait for the server to start answering (headers).
pub const HEADER_TIMEOUT: Duration = Duration::from_secs(30);
/// HTTP/3 gets much less: if the QUIC handshake has not produced an answer in this time, UDP is
/// probably blocked or throttled, and we fall back to TCP instead of making the user wait.
pub const H3_HEADER_TIMEOUT: Duration = Duration::from_secs(4);
/// After an HTTP/3 failure, do not try it again for this origin for this long.
const H3_RETRY_AFTER: Duration = Duration::from_secs(600);

/// Whether and when to use HTTP/3.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum H3Plan {
    /// Never.
    Off,
    /// Use it when the server advertises it (`Alt-Svc: h3=":443"`) on https; fall back to TCP if
    /// QUIC does not work.
    #[default]
    Auto,
    /// Try it regardless of advertisement (diagnostics and tests); still falls back.
    Force,
}

const H3_UNTRIED: u8 = 0;
const H3_WORKING: u8 = 1;
const H3_BROKEN: u8 = 2;

/// Remembers, across downloads, which websites did not answer over QUIC (UDP blocked, ...), so a
/// new download from the same site goes straight to TCP instead of paying the failed attempt again.
#[derive(Default)]
pub struct H3Memory {
    bad: Mutex<std::collections::HashMap<String, Instant>>,
}

impl H3Memory {
    /// `scheme://host:port`
    pub fn origin_key(url: &Url) -> String {
        format!(
            "{}://{}:{}",
            url.scheme(),
            url.host_str().unwrap_or("").to_ascii_lowercase(),
            url.port_or_known_default().unwrap_or(0)
        )
    }

    pub fn mark_bad(&self, origin: String) {
        self.bad.lock().unwrap().insert(origin, Instant::now());
    }

    pub fn clear(&self, origin: &str) {
        self.bad.lock().unwrap().remove(origin);
    }

    pub fn is_bad(&self, origin: &str) -> bool {
        self.is_bad_at(origin, Instant::now())
    }

    fn is_bad_at(&self, origin: &str, now: Instant) -> bool {
        self.bad
            .lock()
            .unwrap()
            .get(origin)
            .is_some_and(|t| now.saturating_duration_since(*t) < H3_RETRY_AFTER)
    }
}

/// Wire protocol label for a response.
pub fn protocol_label(v: reqwest::Version) -> &'static str {
    if v == reqwest::Version::HTTP_3 {
        "HTTP/3"
    } else if v == reqwest::Version::HTTP_2 {
        "HTTP/2"
    } else {
        "HTTP/1.1"
    }
}

/// True if this build can speak HTTP/3 at all.
pub const H3_COMPILED: bool = cfg!(all(feature = "http3", reqwest_unstable));
pub const DEFAULT_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) BoltGrab/0.1";

/// Per-download HTTP options, supplied by the user (or later by the browser extension).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HttpOptions {
    pub user_agent: Option<String>,
    pub referer: Option<String>,
    /// Extra request headers, e.g. `("Authorization", "Bearer ...")`.
    pub headers: Vec<(String, String)>,
    /// A raw cookie string as copied from a browser: `"a=1; b=2"`.
    pub cookies: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    /// Optional HTTP/SOCKS5 proxy, e.g. "http://127.0.0.1:8080" or "socks5://127.0.0.1:1080".
    pub proxy: Option<String>,
}

impl HttpOptions {
    /// Reject malformed headers early, with a message the user can act on.
    pub fn validate(&self) -> Result<(), EngineError> {
        for (name, value) in &self.headers {
            HeaderName::from_bytes(name.trim().as_bytes()).map_err(|_| {
                EngineError::InvalidOption(format!("\"{name}\" is not a valid header name."))
            })?;
            HeaderValue::from_str(value).map_err(|_| {
                EngineError::InvalidOption(format!("The value of header \"{name}\" contains invalid characters."))
            })?;
        }
        if let Some(r) = &self.referer {
            HeaderValue::from_str(r)
                .map_err(|_| EngineError::InvalidOption("The referer contains invalid characters.".into()))?;
        }
        if let Some(ua) = &self.user_agent {
            HeaderValue::from_str(ua)
                .map_err(|_| EngineError::InvalidOption("The user-agent contains invalid characters.".into()))?;
        }
        Ok(())
    }

    /// The options to use for a **mirror** of the same file. A mirror on a different origin
    /// (scheme, host or port) must not receive what was meant for the primary site: passwords,
    /// cookies, or headers that look like credentials are dropped. Same-origin mirrors keep all.
    pub fn for_mirror(&self, primary: &Url, mirror: &Url) -> HttpOptions {
        if same_origin(primary, mirror) {
            return self.clone();
        }
        let mut o = self.clone();
        o.username = None;
        o.password = None;
        o.cookies = None;
        o.headers.retain(|(name, _)| {
            let n = name.to_ascii_lowercase();
            !["auth", "cookie", "token", "key", "secret", "session"].iter().any(|bad| n.contains(bad))
        });
        o
    }

    fn credentials(&self) -> Option<Credentials> {
        match (&self.username, &self.password) {
            (Some(u), p) if !u.is_empty() => Some(Credentials {
                username: u.clone(),
                password: p.clone().unwrap_or_default(),
            }),
            _ => None,
        }
    }
}

/// State shared by all connections of a single download: options, the cookie jar and the
/// negotiated authentication.
pub struct HttpSession {
    opts: HttpOptions,
    jar: Arc<Jar>,
    pub auth: Arc<AuthManager>,
    // ---- HTTP/3 (per origin, shared by all connections of the download) ----
    h3_plan: Mutex<H3Plan>,
    /// Port from `Alt-Svc: h3=":PORT"`, 0 = not advertised.
    h3_port: AtomicU32,
    h3_state: AtomicU8,
    h3_broken_at: Mutex<Option<Instant>>,
}

impl HttpSession {
    pub fn new(opts: &HttpOptions, origin: &Url) -> Self {
        let jar = Arc::new(Jar::default());
        if let Some(raw) = &opts.cookies {
            for pair in raw.split(';').map(str::trim).filter(|p| p.contains('=')) {
                jar.add_cookie_str(&format!("{pair}; Path=/"), origin);
            }
        }
        Self {
            opts: opts.clone(),
            jar,
            auth: Arc::new(AuthManager::new(opts.credentials())),
            h3_plan: Mutex::new(H3Plan::Off),
            h3_port: AtomicU32::new(0),
            h3_state: AtomicU8::new(H3_UNTRIED),
            h3_broken_at: Mutex::new(None),
        }
    }

    /// `local`: bind the connection to this local address (multi-network bonding); `None` lets the
    /// OS choose the adapter.
    fn builder(&self, local: Option<IpAddr>) -> ClientBuilder {
        let ua = self.opts.user_agent.clone().unwrap_or_else(|| DEFAULT_USER_AGENT.to_string());
        let mut b = Client::builder()
            .user_agent(ua)
            .redirect(redirect::Policy::limited(MAX_REDIRECTS))
            .cookie_provider(self.jar.clone())
            .connect_timeout(CONNECT_TIMEOUT)
            // Connection optimisation: keep-alive probes keep NAT mappings open and detect dead
            // peers; no Nagle delay; shared DNS cache (single-flight, serves stale on failure).
            // Dual-stack destinations are raced IPv4 vs IPv6 by the connector (Happy Eyeballs).
            .tcp_keepalive(Some(Duration::from_secs(30)))
            .tcp_nodelay(true)
            .pool_idle_timeout(Duration::from_secs(30))
            .dns_resolver(Arc::new(CachedResolver::new(DnsCache::global().clone(), Family::of_local(local))));
        if let Some(ip) = local {
            b = b.local_address(ip);
        }
        if let Some(proxy_str) = &self.opts.proxy {
            let p_trim = proxy_str.trim();
            if !p_trim.is_empty() {
                if let Ok(proxy) = reqwest::Proxy::all(p_trim) {
                    b = b.proxy(proxy);
                }
            }
        }
        b
    }

    /// Build a **new client with its own connection pool**. Each segment gets its own client so
    /// that N segments really are N parallel TCP connections, even over HTTP/2 (which would
    /// otherwise multiplex them all onto a single connection). Cookies are shared via the jar.
    pub fn client(&self) -> Result<Client, EngineError> {
        self.client_bound(None)
    }

    /// Like [`client`](Self::client), but every connection leaves from `local` (an adapter's address).
    pub fn client_bound(&self, local: Option<IpAddr>) -> Result<Client, EngineError> {
        self.builder(local)
            .build()
            .map_err(|e| EngineError::Other(format!("could not set up the network client: {e}")))
    }

    // ---- HTTP/3 ---------------------------------------------------------------------------

    /// Decide how HTTP/3 is used for this origin, and what the server advertised (`Alt-Svc`).
    pub fn configure_h3(&self, plan: H3Plan, advertised_port: Option<u16>) {
        *self.h3_plan.lock().unwrap() = plan;
        self.h3_port.store(advertised_port.map_or(0, u32::from), Ordering::SeqCst);
    }

    pub fn h3_advertised(&self) -> bool {
        self.h3_port.load(Ordering::SeqCst) != 0
    }

    /// Should the next connection to `url` use HTTP/3?
    pub fn h3_usable(&self, url: &Url) -> bool {
        if !H3_COMPILED {
            return false;
        }
        let plan = *self.h3_plan.lock().unwrap();
        let eligible = match plan {
            H3Plan::Off => false,
            H3Plan::Force => true,
            // QUIC always carries TLS. We only follow an advertisement for the same host and port
            // (`h3=":443"`); other alternative authorities are ignored.
            H3Plan::Auto => {
                url.scheme() == "https"
                    && self.h3_port.load(Ordering::SeqCst) != 0
                    && url.port_or_known_default().map(u32::from) == Some(self.h3_port.load(Ordering::SeqCst))
            }
        };
        if !eligible {
            return false;
        }
        if self.h3_state.load(Ordering::SeqCst) == H3_BROKEN {
            // Broken for a while; give QUIC another chance much later (networks change).
            let expired = self.h3_broken_at.lock().unwrap().is_some_and(|t| t.elapsed() > H3_RETRY_AFTER);
            if expired {
                self.h3_state.store(H3_UNTRIED, Ordering::SeqCst);
            } else {
                return false;
            }
        }
        true
    }

    /// An HTTP/3 request got an answer: remember that QUIC works here.
    pub fn h3_succeeded(&self) {
        self.h3_state.store(H3_WORKING, Ordering::SeqCst);
    }

    /// QUIC failed before any answer (handshake, UDP blocked, ...): use TCP from now on.
    pub fn h3_failed(&self) {
        self.h3_state.store(H3_BROKEN, Ordering::SeqCst);
        *self.h3_broken_at.lock().unwrap() = Some(Instant::now());
    }

    pub fn h3_working(&self) -> bool {
        self.h3_state.load(Ordering::SeqCst) == H3_WORKING
    }

    /// QUIC failed for this origin during this download.
    pub fn h3_broken(&self) -> bool {
        self.h3_state.load(Ordering::SeqCst) == H3_BROKEN
    }

    /// A client that speaks HTTP/3 only (QUIC over UDP). Verified against the Windows / system
    /// certificate store, like the TCP client.
    #[cfg(all(feature = "http3", reqwest_unstable))]
    pub fn client_h3(&self, local: Option<IpAddr>) -> Result<Client, EngineError> {
        self.builder(local)
            .use_rustls_tls()
            .http3_prior_knowledge()
            .build()
            .map_err(|e| EngineError::Other(format!("could not set up the HTTP/3 client: {e}")))
    }

    #[cfg(not(all(feature = "http3", reqwest_unstable)))]
    pub fn client_h3(&self, _local: Option<IpAddr>) -> Result<Client, EngineError> {
        Err(EngineError::Other("HTTP/3 support is not compiled into this build".into()))
    }

    /// Start a request with all session options applied.
    pub fn request(&self, client: &Client, method: Method, url: &Url) -> RequestBuilder {
        // We always ask for the raw bytes: Range offsets and Content-Length refer to the
        // encoded representation, so compression would corrupt resume.
        let mut rb = client
            .request(method.clone(), url.clone())
            .header(ACCEPT_ENCODING, "identity");
        if let Some(r) = &self.opts.referer {
            rb = rb.header(REFERER, r.as_str());
        }
        for (name, value) in &self.opts.headers {
            rb = rb.header(name.trim(), value.as_str());
        }
        if let Some(h) = self.auth.authorization(method.as_str(), &request_target(url)) {
            rb = rb.header(AUTHORIZATION, h);
        }
        rb
    }
}

/// Same scheme, host and port.
pub fn same_origin(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme()
        && a.host_str().map(str::to_ascii_lowercase) == b.host_str().map(str::to_ascii_lowercase)
        && a.port_or_known_default() == b.port_or_known_default()
}

/// Path + query: the `uri` that Digest authentication signs.
pub fn request_target(url: &Url) -> String {
    match url.query() {
        Some(q) => format!("{}?{}", url.path(), q),
        None => url.path().to_string(),
    }
}

/// Send a request, handling a 401 challenge once. The send can be interrupted by `cancel`
/// (returns [`EngineError::Stopped`]) and gives up after `header_timeout`.
pub async fn send_with_auth(
    session: &HttpSession,
    client: &Client,
    method: Method,
    url: &Url,
    cancel: Option<&CancellationToken>,
    header_timeout: Duration,
    configure: impl Fn(RequestBuilder) -> RequestBuilder,
) -> Result<Response, EngineError> {
    for attempt in 0..2 {
        let rb = configure(session.request(client, method.clone(), url));
        let send = tokio::time::timeout(header_timeout, rb.send());
        let result = match cancel {
            Some(c) => tokio::select! {
                _ = c.cancelled() => return Err(EngineError::Stopped),
                r = send => r,
            },
            None => send.await,
        };
        let resp = match result {
            Err(_) => return Err(EngineError::Timeout("the server took too long to respond".into())),
            Ok(Err(e)) => return Err(e.into()),
            Ok(Ok(r)) => r,
        };
        if resp.status().as_u16() == 401 && attempt == 0 {
            let challenges: Vec<String> = resp
                .headers()
                .get_all(WWW_AUTHENTICATE)
                .iter()
                .filter_map(|v| v.to_str().ok().map(str::to_string))
                .collect();
            if session.auth.on_challenge(&challenges) {
                continue;
            }
        }
        return Ok(resp);
    }
    Err(EngineError::AuthFailed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_target_includes_query() {
        let u = Url::parse("https://h.example/a/b.zip?token=1&x=2").unwrap();
        assert_eq!(request_target(&u), "/a/b.zip?token=1&x=2");
        let u = Url::parse("https://h.example/a").unwrap();
        assert_eq!(request_target(&u), "/a");
    }

    #[test]
    fn validates_headers() {
        let mut o = HttpOptions::default();
        assert!(o.validate().is_ok());
        o.headers = vec![("X-Token".into(), "abc".into())];
        assert!(o.validate().is_ok());
        o.headers = vec![("Bad Header".into(), "abc".into())];
        assert!(o.validate().is_err());
        o.headers = vec![("X-Ok".into(), "line\nbreak".into())];
        assert!(o.validate().is_err());
    }

    #[test]
    fn origins_compare_scheme_host_and_port() {
        let u = |s: &str| Url::parse(s).unwrap();
        assert!(same_origin(&u("https://a.example/x"), &u("https://A.example:443/y")));
        assert!(!same_origin(&u("https://a.example/x"), &u("http://a.example/x")));
        assert!(!same_origin(&u("https://a.example/x"), &u("https://b.example/x")));
        assert!(!same_origin(&u("http://127.0.0.1:8001/x"), &u("http://127.0.0.1:8002/x")));
    }

    #[test]
    fn credentials_never_reach_a_mirror_on_another_origin() {
        let o = HttpOptions {
            username: Some("alice".into()),
            password: Some("pw".into()),
            cookies: Some("sid=1".into()),
            referer: Some("https://page.example/".into()),
            user_agent: Some("UA/1".into()),
            proxy: None,
            headers: vec![
                ("Authorization".into(), "Bearer x".into()),
                ("X-Api-Key".into(), "k".into()),
                ("Cookie".into(), "a=b".into()),
                ("Accept-Language".into(), "en".into()),
            ],
        };
        let primary = Url::parse("https://files.example/a.bin").unwrap();

        let same = o.for_mirror(&primary, &Url::parse("https://files.example/b.bin").unwrap());
        assert_eq!(same.username.as_deref(), Some("alice"));
        assert_eq!(same.headers.len(), 4);

        let other = o.for_mirror(&primary, &Url::parse("https://mirror.example/a.bin").unwrap());
        assert!(other.username.is_none() && other.password.is_none() && other.cookies.is_none());
        assert_eq!(other.headers, vec![("Accept-Language".to_string(), "en".to_string())]);
        // Harmless settings are kept.
        assert_eq!(other.user_agent.as_deref(), Some("UA/1"));
        assert_eq!(other.referer.as_deref(), Some("https://page.example/"));
    }

    fn session() -> HttpSession {
        HttpSession::new(&HttpOptions::default(), &Url::parse("https://example.com/").unwrap())
    }

    #[test]
    fn http3_is_used_only_when_advertised_on_https_default_port() {
        if !H3_COMPILED {
            return;
        }
        let s = session();
        let https = Url::parse("https://example.com/f").unwrap();
        s.configure_h3(H3Plan::Auto, None);
        assert!(!s.h3_usable(&https), "not advertised");
        s.configure_h3(H3Plan::Auto, Some(443));
        assert!(s.h3_usable(&https));
        assert!(!s.h3_usable(&Url::parse("http://example.com/f").unwrap()), "QUIC needs https");
        assert!(!s.h3_usable(&Url::parse("https://example.com:8443/f").unwrap()), "other port: not what was advertised");
        s.configure_h3(H3Plan::Off, Some(443));
        assert!(!s.h3_usable(&https));
        s.configure_h3(H3Plan::Force, None);
        assert!(s.h3_usable(&https) && s.h3_usable(&Url::parse("http://example.com/f").unwrap()));
    }

    #[test]
    fn http3_failure_switches_the_origin_to_tcp_for_everyone() {
        if !H3_COMPILED {
            return;
        }
        let s = session();
        let url = Url::parse("https://example.com/f").unwrap();
        s.configure_h3(H3Plan::Auto, Some(443));
        assert!(s.h3_usable(&url));
        s.h3_failed();
        assert!(!s.h3_usable(&url), "QUIC is skipped after a failure");
        assert!(!s.h3_working());
        // A success (e.g. from a later retry) re-enables it.
        s.h3_succeeded();
        assert!(s.h3_usable(&url) && s.h3_working());
    }

    #[test]
    fn a_site_that_failed_over_quic_is_skipped_for_ten_minutes() {
        let m = H3Memory::default();
        let origin = H3Memory::origin_key(&Url::parse("https://Files.Example.com/a").unwrap());
        assert_eq!(origin, "https://files.example.com:443");
        assert!(!m.is_bad(&origin));
        m.mark_bad(origin.clone());
        assert!(m.is_bad(&origin));
        let later = Instant::now() + H3_RETRY_AFTER + Duration::from_secs(1);
        assert!(!m.is_bad_at(&origin, later), "QUIC gets another chance after the quarantine");
        m.clear(&origin);
        assert!(!m.is_bad(&origin));
        // Other origins (different host or port) are unaffected.
        m.mark_bad(origin.clone());
        assert!(!m.is_bad(&H3Memory::origin_key(&Url::parse("https://other.example.com/").unwrap())));
        assert!(!m.is_bad(&H3Memory::origin_key(&Url::parse("https://files.example.com:8443/").unwrap())));
    }

    #[test]
    fn protocol_labels() {
        assert_eq!(protocol_label(reqwest::Version::HTTP_3), "HTTP/3");
        assert_eq!(protocol_label(reqwest::Version::HTTP_2), "HTTP/2");
        assert_eq!(protocol_label(reqwest::Version::HTTP_11), "HTTP/1.1");
    }

    #[test]
    fn credentials_need_a_username() {
        let mut o = HttpOptions::default();
        assert!(o.credentials().is_none());
        o.username = Some("bob".into());
        let c = o.credentials().unwrap();
        assert_eq!((c.username.as_str(), c.password.as_str()), ("bob", ""));
    }
}
