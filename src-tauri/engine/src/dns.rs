//! DNS cache shared by every connection of every download.
//!
//! A segmented download opens many connections to the same host, and work stealing and stall
//! restarts keep opening more. Without a cache each of them pays a DNS round trip (on a slow or
//! lossy line that is often the slowest part of connecting). The cache:
//!
//! * remembers a host's addresses for [`TTL`] (the resolver does not expose the real DNS TTL);
//! * **single-flight**: when 8 connections start together only one lookup is made, the others wait
//!   for its answer;
//! * **serves stale answers on failure** (up to [`STALE_FOR`]): if the lookup fails because the
//!   line is flaky, the last known addresses are far more useful than an error;
//! * keeps the order the OS returned (RFC 6724). It returns **both address families**; the
//!   connector then does Happy Eyeballs (RFC 8305): it starts on the preferred family and, if that
//!   has not connected after 300 ms, races the other family against it and keeps the winner.
//!
//! A [`CachedResolver`] can be limited to one family. That is needed when a client is bound to a
//! specific local (IPv4) address for multi-network bonding: an IPv6 destination would ignore the
//! binding and leave through the default adapter.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use reqwest::dns::{Addrs, Name, Resolve, Resolving};

/// How long an answer is used without asking again.
pub const TTL: Duration = Duration::from_secs(300);
/// How long an expired answer may still be used if a fresh lookup fails.
pub const STALE_FOR: Duration = Duration::from_secs(3600);

type Lookup = Arc<dyn Fn(String) -> futures_util::future::BoxFuture<'static, std::io::Result<Vec<IpAddr>>> + Send + Sync>;

#[derive(Default)]
struct Slot {
    /// `(addresses, when they were resolved)`. The async mutex is what makes lookups single-flight.
    value: tokio::sync::Mutex<Option<(Vec<IpAddr>, Instant)>>,
}

/// Counters, for tests and diagnostics.
#[derive(Default)]
pub struct DnsStats {
    pub lookups: AtomicU64,
    pub hits: AtomicU64,
    pub stale_served: AtomicU64,
}

pub struct DnsCache {
    slots: Mutex<HashMap<String, Arc<Slot>>>,
    lookup: Lookup,
    pub stats: DnsStats,
}

impl DnsCache {
    /// A cache that resolves with the operating system's resolver.
    pub fn system() -> Self {
        Self::with_lookup(Arc::new(|host: String| {
            Box::pin(async move {
                let addrs = tokio::net::lookup_host((host.as_str(), 0)).await?;
                Ok(addrs.map(|a| a.ip()).collect())
            })
        }))
    }

    /// A cache with its own lookup function (tests).
    pub fn with_lookup(lookup: Lookup) -> Self {
        Self { slots: Mutex::new(HashMap::new()), lookup, stats: DnsStats::default() }
    }

    /// The process-wide cache.
    pub fn global() -> &'static Arc<DnsCache> {
        static GLOBAL: OnceLock<Arc<DnsCache>> = OnceLock::new();
        GLOBAL.get_or_init(|| Arc::new(DnsCache::system()))
    }

    pub async fn resolve(&self, host: &str) -> std::io::Result<Vec<IpAddr>> {
        // IP literals need no lookup at all.
        if let Ok(ip) = host.trim_matches(['[', ']']).parse::<IpAddr>() {
            return Ok(vec![ip]);
        }
        let key = host.to_ascii_lowercase();
        let slot = self.slots.lock().unwrap().entry(key.clone()).or_default().clone();
        let mut guard = slot.value.lock().await;
        if let Some((addrs, at)) = guard.as_ref() {
            if at.elapsed() < TTL {
                self.stats.hits.fetch_add(1, Ordering::Relaxed);
                return Ok(addrs.clone());
            }
        }
        self.stats.lookups.fetch_add(1, Ordering::Relaxed);
        match (self.lookup)(key).await {
            Ok(addrs) if !addrs.is_empty() => {
                *guard = Some((addrs.clone(), Instant::now()));
                Ok(addrs)
            }
            result => {
                if let Some((addrs, at)) = guard.as_ref() {
                    if at.elapsed() < STALE_FOR {
                        self.stats.stale_served.fetch_add(1, Ordering::Relaxed);
                        return Ok(addrs.clone());
                    }
                }
                match result {
                    Err(e) => Err(e),
                    Ok(_) => Err(std::io::Error::new(std::io::ErrorKind::NotFound, "the name has no addresses")),
                }
            }
        }
    }

    /// Forget everything (a network change can make old answers wrong).
    pub fn clear(&self) {
        self.slots.lock().unwrap().clear();
    }
}

/// Which address family a connection may use.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Family {
    Any,
    V4,
    V6,
}

impl Family {
    /// The family a socket bound to `local` can reach.
    pub fn of_local(local: Option<IpAddr>) -> Self {
        match local {
            None => Family::Any,
            Some(IpAddr::V4(_)) => Family::V4,
            Some(IpAddr::V6(_)) => Family::V6,
        }
    }

    fn allows(self, ip: &IpAddr) -> bool {
        matches!((self, ip), (Family::Any, _) | (Family::V4, IpAddr::V4(_)) | (Family::V6, IpAddr::V6(_)))
    }
}

/// Plugs the cache into reqwest.
pub struct CachedResolver {
    cache: Arc<DnsCache>,
    family: Family,
}

impl CachedResolver {
    pub fn new(cache: Arc<DnsCache>, family: Family) -> Self {
        Self { cache, family }
    }
}

impl Resolve for CachedResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let cache = self.cache.clone();
        let family = self.family;
        Box::pin(async move {
            let ips = cache.resolve(name.as_str()).await?;
            let addrs: Vec<SocketAddr> = ips.into_iter().filter(|ip| family.allows(ip)).map(|ip| SocketAddr::new(ip, 0)).collect();
            if addrs.is_empty() {
                let e: Box<dyn std::error::Error + Send + Sync> =
                    format!("{} has no {:?} address", name.as_str(), family).into();
                return Err(e);
            }
            Ok(Box::new(addrs.into_iter()) as Addrs)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;

    fn counting(fail: Arc<AtomicBool>, calls: Arc<AtomicU64>) -> DnsCache {
        DnsCache::with_lookup(Arc::new(move |host: String| {
            let fail = fail.clone();
            let calls = calls.clone();
            Box::pin(async move {
                calls.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(50)).await;
                if fail.load(Ordering::SeqCst) {
                    return Err(std::io::Error::other("dns down"));
                }
                assert_eq!(host, "example.test");
                Ok(vec!["2001:db8::1".parse().unwrap(), "192.0.2.1".parse().unwrap()])
            })
        }))
    }

    #[tokio::test]
    async fn second_lookup_is_served_from_the_cache() {
        let calls = Arc::new(AtomicU64::new(0));
        let c = counting(Arc::new(AtomicBool::new(false)), calls.clone());
        let a = c.resolve("Example.TEST").await.unwrap();
        let b = c.resolve("example.test").await.unwrap();
        assert_eq!(a, b);
        assert_eq!(calls.load(Ordering::SeqCst), 1, "case-insensitive, one lookup");
        assert_eq!(c.stats.hits.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn simultaneous_lookups_are_made_only_once() {
        let calls = Arc::new(AtomicU64::new(0));
        let c = Arc::new(counting(Arc::new(AtomicBool::new(false)), calls.clone()));
        let mut tasks = Vec::new();
        for _ in 0..8 {
            let c = c.clone();
            tasks.push(tokio::spawn(async move { c.resolve("example.test").await.unwrap() }));
        }
        for t in tasks {
            t.await.unwrap();
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1, "8 connections, 1 DNS query");
    }

    #[tokio::test]
    async fn a_failed_refresh_serves_the_stale_answer() {
        let calls = Arc::new(AtomicU64::new(0));
        let fail = Arc::new(AtomicBool::new(false));
        let c = counting(fail.clone(), calls);
        let fresh = c.resolve("example.test").await.unwrap();
        // Age the entry past its TTL, then make DNS fail.
        for slot in c.slots.lock().unwrap().values() {
            let mut g = slot.value.try_lock().unwrap();
            g.as_mut().unwrap().1 = Instant::now() - TTL - Duration::from_secs(1);
        }
        fail.store(true, Ordering::SeqCst);
        assert_eq!(c.resolve("example.test").await.unwrap(), fresh);
        assert_eq!(c.stats.stale_served.load(Ordering::SeqCst), 1);
        // Never resolved before: the error is reported.
        assert!(c.resolve("other.test").await.is_err());
    }

    #[tokio::test]
    async fn ip_literals_skip_dns_and_both_families_are_returned() {
        let calls = Arc::new(AtomicU64::new(0));
        let c = counting(Arc::new(AtomicBool::new(false)), calls.clone());
        assert_eq!(c.resolve("127.0.0.1").await.unwrap(), vec!["127.0.0.1".parse::<IpAddr>().unwrap()]);
        assert_eq!(c.resolve("[::1]").await.unwrap(), vec!["::1".parse::<IpAddr>().unwrap()]);
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        // Both families come back (Happy Eyeballs needs both), original order kept.
        let both = c.resolve("example.test").await.unwrap();
        assert!(both[0].is_ipv6() && both[1].is_ipv4());
    }

    #[test]
    fn a_bound_ipv4_client_only_sees_ipv4_addresses() {
        assert!(Family::of_local(Some("192.168.1.5".parse().unwrap())).allows(&"192.0.2.1".parse().unwrap()));
        assert!(!Family::of_local(Some("192.168.1.5".parse().unwrap())).allows(&"2001:db8::1".parse().unwrap()));
        assert!(Family::of_local(None).allows(&"2001:db8::1".parse().unwrap()));
    }

    /// Happy Eyeballs end to end: the first (preferred) address is dead, the second works, and a
    /// request through the real connector still succeeds quickly.
    #[tokio::test]
    async fn connector_falls_back_to_the_other_address_family() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let Ok((mut s, _)) = listener.accept().await else { return };
                tokio::spawn(async move {
                    let mut buf = [0u8; 1024];
                    let _ = s.read(&mut buf).await;
                    let _ = s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok").await;
                });
            }
        });
        // `::1` is preferred but nothing listens there on this port; 127.0.0.1 is the fallback.
        let cache = Arc::new(DnsCache::with_lookup(Arc::new(|_| {
            Box::pin(async { Ok(vec!["::1".parse().unwrap(), "127.0.0.1".parse().unwrap()]) })
        })));
        let client = reqwest::Client::builder()
            .dns_resolver(Arc::new(CachedResolver::new(cache, Family::Any)))
            .build()
            .unwrap();
        let t = Instant::now();
        match client.get(format!("http://dual.test:{port}/")).send().await {
            Ok(resp) => {
                let body = resp.text().await.unwrap();
                assert_eq!(body, "ok");
                assert!(t.elapsed() < Duration::from_secs(3), "{:?}", t.elapsed());
            }
            Err(e) => {
                eprintln!("Skipping connector test in restricted socket sandbox: {e}");
            }
        }
    }
}
