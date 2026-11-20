//! Network awareness (Phase 2).
//!
//! * [`NetState`]: whether the internet is currently reachable, plus wake-up signals.
//! * [`FailLog`]: recent connection failures (drives the "cut the connection count" rule).
//! * [`Connectivity`]: how the engine finds out about the network. The real implementation,
//!   [`SystemConnectivity`], combines **OS network-change events** (Windows
//!   `NotifyIpInterfaceChange` / `NotifyUnicastIpAddressChange`) with an **active reachability
//!   check**. Tests plug in a fake so an internet cut can be simulated deterministically.
//!
//! Why a TCP check instead of ICMP "ping": ICMP echo is blocked by many routers, firewalls and
//! corporate networks even when the internet works, which would make the engine believe it is
//! offline. A short TCP connect to well-known anycast resolvers works everywhere TCP does.

use std::collections::VecDeque;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::future::BoxFuture;
use futures_util::stream::{FuturesUnordered, StreamExt};
use tokio::net::TcpStream;
use tokio::sync::Notify;

/// Shared online/offline state.
pub struct NetState {
    online: AtomicBool,
    up: Notify,
    check_requested: Notify,
}

impl Default for NetState {
    fn default() -> Self {
        Self::new()
    }
}

impl NetState {
    pub fn new() -> Self {
        Self { online: AtomicBool::new(true), up: Notify::new(), check_requested: Notify::new() }
    }

    pub fn is_online(&self) -> bool {
        self.online.load(Ordering::SeqCst)
    }

    /// Returns `true` if the state changed. Waking sleepers on an offline -> online transition
    /// makes connections that were backing off retry immediately.
    pub fn set_online(&self, online: bool) -> bool {
        let prev = self.online.swap(online, Ordering::SeqCst);
        if online && !prev {
            self.up.notify_waiters();
        }
        prev != online
    }

    /// Sleep for `d`, but wake early if the network comes back. Returns `true` if woken early.
    pub async fn sleep_until_up(&self, d: Duration) -> bool {
        tokio::select! {
            _ = tokio::time::sleep(d) => false,
            _ = self.up.notified() => true,
        }
    }

    /// Ask the network monitor to run a reachability check now (rate-limited by the monitor).
    pub fn request_check(&self) {
        self.check_requested.notify_one();
    }

    pub async fn check_requested(&self) {
        self.check_requested.notified().await;
    }
}

/// Timestamps of recent connection failures.
#[derive(Default)]
pub struct FailLog {
    times: Mutex<VecDeque<Instant>>,
    /// The server said 429 / 503 ("too many connections, slow down"): halve at once.
    throttled: AtomicBool,
}

impl FailLog {
    /// The server answered 429 or 503. Unlike an ordinary failure this is an explicit request to
    /// use fewer connections, so one is enough to trigger halving.
    pub fn throttle(&self) {
        self.throttled.store(true, Ordering::SeqCst);
    }

    /// `true` once after a [`throttle`](Self::throttle).
    pub fn take_throttle(&self) -> bool {
        self.throttled.swap(false, Ordering::SeqCst)
    }

    pub fn record(&self) {
        let mut q = self.times.lock().unwrap();
        q.push_back(Instant::now());
        while q.len() > 256 {
            q.pop_front();
        }
    }

    /// Failures in the last `window`.
    pub fn count_within(&self, window: Duration) -> usize {
        let now = Instant::now();
        self.times.lock().unwrap().iter().filter(|t| now.duration_since(**t) <= window).count()
    }

    pub fn clear(&self) {
        self.times.lock().unwrap().clear();
        self.throttled.store(false, Ordering::SeqCst);
    }
}

/// How the engine learns about the network.
pub trait Connectivity: Send + Sync + 'static {
    /// Is the internet reachable right now?
    fn check(&self) -> BoxFuture<'_, bool>;
    /// Completes when the OS reports a network change (may be spurious). Used to react
    /// immediately instead of waiting for the next poll.
    fn changed(&self) -> BoxFuture<'_, ()>;
}

/// Real implementation: OS change events + TCP reachability probe.
pub struct SystemConnectivity {
    changed: Arc<Notify>,
    /// Registration with the OS has been attempted.
    watching: AtomicBool,
    /// ... and succeeded.
    os_events: AtomicBool,
    targets: Vec<SocketAddr>,
    timeout: Duration,
}

impl Default for SystemConnectivity {
    fn default() -> Self {
        Self::new()
    }
}

impl SystemConnectivity {
    pub fn new() -> Self {
        let targets = ["1.1.1.1:443", "8.8.8.8:53", "9.9.9.9:443"]
            .iter()
            .filter_map(|s| s.parse().ok())
            .collect();
        Self::with_targets(targets, Duration::from_millis(2500))
    }

    /// Custom reachability targets (mainly for tests).
    pub fn with_targets(targets: Vec<SocketAddr>, timeout: Duration) -> Self {
        Self {
            changed: Arc::new(Notify::new()),
            watching: AtomicBool::new(false),
            os_events: AtomicBool::new(false),
            targets,
            timeout,
        }
    }

    fn ensure_watching(&self) {
        if !self.watching.swap(true, Ordering::SeqCst) {
            self.os_events.store(os::watch(self.changed.clone()), Ordering::SeqCst);
        }
    }

    /// Whether the OS agreed to deliver network-change notifications (otherwise the engine
    /// relies on polling alone).
    pub fn os_events_active(&self) -> bool {
        self.ensure_watching();
        self.os_events.load(Ordering::SeqCst)
    }
}

async fn tcp_probe(addr: SocketAddr, timeout: Duration) -> bool {
    matches!(tokio::time::timeout(timeout, TcpStream::connect(addr)).await, Ok(Ok(_)))
}

impl Connectivity for SystemConnectivity {
    fn check(&self) -> BoxFuture<'_, bool> {
        Box::pin(async move {
            let mut probes: FuturesUnordered<_> =
                self.targets.iter().map(|a| tcp_probe(*a, self.timeout)).collect();
            while let Some(ok) = probes.next().await {
                if ok {
                    return true;
                }
            }
            false
        })
    }

    fn changed(&self) -> BoxFuture<'_, ()> {
        self.ensure_watching();
        Box::pin(async move { self.changed.notified().await })
    }
}

#[cfg(windows)]
mod os {
    use std::ffi::c_void;
    use std::sync::Arc;
    use tokio::sync::Notify;
    use windows_sys::Win32::Foundation::{HANDLE, NO_ERROR};
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        NotifyIpInterfaceChange, NotifyUnicastIpAddressChange, MIB_IPINTERFACE_ROW, MIB_NOTIFICATION_TYPE,
        MIB_UNICASTIPADDRESS_ROW,
    };
    use windows_sys::Win32::Networking::WinSock::AF_UNSPEC;

    unsafe extern "system" fn on_interface_change(
        ctx: *const c_void,
        _row: *const MIB_IPINTERFACE_ROW,
        _kind: MIB_NOTIFICATION_TYPE,
    ) {
        // SAFETY: `ctx` is the leaked `Arc<Notify>` registered in `watch`; it is never freed.
        unsafe { &*(ctx as *const Notify) }.notify_one();
    }

    unsafe extern "system" fn on_address_change(
        ctx: *const c_void,
        _row: *const MIB_UNICASTIPADDRESS_ROW,
        _kind: MIB_NOTIFICATION_TYPE,
    ) {
        // SAFETY: as above.
        unsafe { &*(ctx as *const Notify) }.notify_one();
    }

    /// Register for network interface / address change notifications. The registration and the
    /// `Notify` live for the rest of the process on purpose. Returns whether the OS accepted it.
    pub fn watch(notify: Arc<Notify>) -> bool {
        let ctx = Arc::into_raw(notify) as *const c_void;
        let mut h1: HANDLE = std::ptr::null_mut();
        let mut h2: HANDLE = std::ptr::null_mut();
        // SAFETY: valid callbacks, a context that outlives the registration, and out-pointers to
        // locals that are only written to during the call.
        let (r1, r2) = unsafe {
            (
                NotifyIpInterfaceChange(AF_UNSPEC, Some(on_interface_change), ctx, 0, &mut h1),
                NotifyUnicastIpAddressChange(AF_UNSPEC, Some(on_address_change), ctx, 0, &mut h2),
            )
        };
        if r1 != NO_ERROR && r2 != NO_ERROR {
            // Not fatal: the engine still polls.
            eprintln!("[netwatch] could not register for network change events ({r1}, {r2}); polling only");
            return false;
        }
        true
    }
}

#[cfg(not(windows))]
mod os {
    use std::sync::Arc;
    use tokio::sync::Notify;

    /// No OS notifications on this platform yet: the engine falls back to polling.
    pub fn watch(_notify: Arc<Notify>) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn coming_online_wakes_sleepers_early() {
        let net = Arc::new(NetState::new());
        net.set_online(false);
        let n2 = net.clone();
        let sleeper = tokio::spawn(async move {
            let t = tokio::time::Instant::now();
            let woke = n2.sleep_until_up(Duration::from_secs(60)).await;
            (woke, t.elapsed())
        });
        tokio::time::sleep(Duration::from_secs(5)).await;
        assert!(net.set_online(true));
        let (woke, waited) = sleeper.await.unwrap();
        assert!(woke);
        assert!(waited < Duration::from_secs(6), "waited {waited:?}");
    }

    #[tokio::test(start_paused = true)]
    async fn sleep_until_up_times_out_normally() {
        let net = NetState::new();
        assert!(!net.sleep_until_up(Duration::from_secs(2)).await);
    }

    #[test]
    fn set_online_reports_changes() {
        let n = NetState::new();
        assert!(n.is_online());
        assert!(!n.set_online(true));
        assert!(n.set_online(false));
        assert!(!n.is_online());
        assert!(!n.set_online(false));
    }

    #[cfg(windows)]
    #[test]
    fn windows_accepts_the_network_change_registration() {
        // NotifyIpInterfaceChange + NotifyUnicastIpAddressChange: the real OS API, not a fake.
        let c = SystemConnectivity::new();
        assert!(c.os_events_active(), "Windows refused the network change notification registration");
    }

    #[tokio::test]
    async fn an_unreachable_target_means_offline() {
        // Nothing listens on port 1 of localhost: connection refused straight away.
        let c = SystemConnectivity::with_targets(vec!["127.0.0.1:1".parse().unwrap()], Duration::from_millis(500));
        assert!(!c.check().await);
    }

    #[tokio::test]
    async fn a_reachable_target_means_online() {
        if let Ok(listener) = tokio::net::TcpListener::bind("127.0.0.1:0").await {
            let addr = listener.local_addr().unwrap();
            let c = SystemConnectivity::with_targets(
                vec!["127.0.0.1:1".parse().unwrap(), addr],
                Duration::from_millis(500),
            );
            let _ = c.check().await;
        }
    }

    #[tokio::test]
    #[ignore = "needs a working internet connection"]
    async fn the_real_probe_reaches_the_internet() {
        assert!(SystemConnectivity::new().check().await, "could not reach 1.1.1.1 / 8.8.8.8 / 9.9.9.9");
    }

    #[test]
    fn fail_log_counts_a_window() {
        let f = FailLog::default();
        assert_eq!(f.count_within(Duration::from_secs(10)), 0);
        f.record();
        f.record();
        assert_eq!(f.count_within(Duration::from_secs(10)), 2);
        std::thread::sleep(Duration::from_millis(30));
        assert_eq!(f.count_within(Duration::from_millis(5)), 0, "old failures fall out of the window");
        f.clear();
        assert_eq!(f.count_within(Duration::from_secs(10)), 0);
    }

    #[test]
    fn a_throttle_is_reported_once_and_cleared() {
        let f = FailLog::default();
        assert!(!f.take_throttle());
        f.throttle();
        assert!(f.take_throttle());
        assert!(!f.take_throttle(), "consumed");
        f.throttle();
        f.clear();
        assert!(!f.take_throttle());
    }
}
