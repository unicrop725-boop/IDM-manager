//! Token-bucket speed limiter.
//!
//! One limiter is shared by every connection of every download (the *global* limit) and each
//! download owns another one (the *per-download* limit). A worker acquires from both before it
//! accepts a chunk, so TCP back-pressure throttles the transfer.
//!
//! Rate 0 means "unlimited".

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tokio::time::Instant;

/// How much unused allowance may be saved up, in seconds of traffic.
const BURST_SECONDS: f64 = 0.25;

/// Longest uninterrupted sleep while waiting for tokens; bounds how long a changed limit
/// takes to be noticed by a waiting connection.
const WAIT_SLICE: Duration = Duration::from_millis(100);

pub struct RateLimiter {
    /// Bytes per second; 0 = unlimited.
    rate: AtomicU64,
    bucket: Mutex<Bucket>,
}

struct Bucket {
    /// Available tokens (bytes). May go negative: that is a "debt" the caller sleeps off.
    tokens: f64,
    last: Instant,
}

fn burst(rate: u64) -> f64 {
    rate as f64 * BURST_SECONDS
}

impl RateLimiter {
    pub fn new(bytes_per_sec: u64) -> Self {
        Self {
            rate: AtomicU64::new(bytes_per_sec),
            bucket: Mutex::new(Bucket {
                tokens: burst(bytes_per_sec),
                last: Instant::now(),
            }),
        }
    }

    pub fn rate(&self) -> u64 {
        self.rate.load(Ordering::Relaxed)
    }

    /// Change the limit; takes effect immediately for all connections sharing this limiter.
    pub fn set_rate(&self, bytes_per_sec: u64) {
        self.rate.store(bytes_per_sec, Ordering::Relaxed);
        let mut b = self.bucket.lock().unwrap();
        b.tokens = b.tokens.min(burst(bytes_per_sec));
        b.last = Instant::now();
    }

    /// Wait until `n` bytes may be consumed.
    ///
    /// The wait is served in short slices and the rate is re-read after each one. Many
    /// connections may have booked seconds of "debt" at the old rate; without re-checking, a
    /// user lifting or raising the limit would have to wait for all of that to drain.
    pub async fn acquire(&self, n: u64) {
        let Some((wait, mut rate_seen)) = self.reserve(n) else { return };
        // An absolute deadline (not "wait -= slice") so oversleeping under CPU load cannot
        // accumulate into a longer total wait.
        let mut deadline = Instant::now() + wait;
        loop {
            let now = Instant::now();
            if now >= deadline {
                return;
            }
            tokio::time::sleep((deadline - now).min(WAIT_SLICE)).await;
            let rate_now = self.rate();
            if rate_now == 0 {
                return; // limit removed: release everyone at once
            }
            if rate_now != rate_seen {
                // The remaining debt is a number of bytes; at the new rate it takes
                // proportionally more or less time to pay off.
                let now = Instant::now();
                let remaining = deadline.saturating_duration_since(now);
                deadline = now + remaining.mul_f64(rate_seen as f64 / rate_now as f64);
                rate_seen = rate_now;
            }
        }
    }

    /// Take `n` tokens; returns how long the caller must wait before using them, together with
    /// the rate that wait was computed at.
    fn reserve(&self, n: u64) -> Option<(Duration, u64)> {
        let mut b = self.bucket.lock().unwrap();
        let rate = self.rate.load(Ordering::Relaxed);
        if rate == 0 || n == 0 {
            return None;
        }
        let now = Instant::now();
        let elapsed = now.duration_since(b.last).as_secs_f64();
        b.last = now;
        b.tokens = (b.tokens + elapsed * rate as f64).min(burst(rate));
        b.tokens -= n as f64;
        if b.tokens < 0.0 {
            Some((Duration::from_secs_f64(-b.tokens / rate as f64), rate))
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn unlimited_never_waits() {
        let l = RateLimiter::new(0);
        let t = Instant::now();
        l.acquire(1_000_000_000).await;
        assert!(t.elapsed() < Duration::from_millis(1));
    }

    #[tokio::test(start_paused = true)]
    async fn limited_rate_is_enforced() {
        // 1 MB/s: consuming 4 MB must take roughly 3.75 s (the first 0.25 s of burst is free).
        let l = RateLimiter::new(1_000_000);
        let t = Instant::now();
        for _ in 0..40 {
            l.acquire(100_000).await;
        }
        let secs = t.elapsed().as_secs_f64();
        assert!((3.5..4.2).contains(&secs), "took {secs}s");
    }

    #[tokio::test(start_paused = true)]
    async fn rate_can_change_while_running() {
        let l = RateLimiter::new(1_000_000);
        l.acquire(250_000).await; // drains the burst
        l.set_rate(0);
        let t = Instant::now();
        l.acquire(50_000_000).await;
        assert!(t.elapsed() < Duration::from_millis(1));
        l.set_rate(2_000_000);
        let t = Instant::now();
        for _ in 0..20 {
            l.acquire(200_000).await;
        }
        let secs = t.elapsed().as_secs_f64();
        assert!((1.7..2.2).contains(&secs), "took {secs}s");
    }

    #[tokio::test(start_paused = true)]
    async fn lifting_the_limit_releases_sleeping_waiters_immediately() {
        // 10 MB at 1 MB/s would sleep ~10 s. Lift the limit after 1 s: the waiter must wake
        // within one slice instead of finishing the old sleep.
        let l = std::sync::Arc::new(RateLimiter::new(1_000_000));
        let start = Instant::now();
        let waiter = {
            let l = l.clone();
            tokio::spawn(async move { l.acquire(10_000_000).await })
        };
        tokio::time::sleep(Duration::from_secs(1)).await;
        l.set_rate(0);
        waiter.await.unwrap();
        let secs = start.elapsed().as_secs_f64();
        assert!(secs < 1.3, "waiter was not released promptly: {secs}s");
    }

    #[tokio::test(start_paused = true)]
    async fn raising_the_limit_shortens_the_remaining_wait() {
        // 8 MB at 1 MB/s = ~8 s. After 1 s raise to 4 MB/s: remaining ~7 MB of debt takes ~1.75 s.
        let l = std::sync::Arc::new(RateLimiter::new(1_000_000));
        let start = Instant::now();
        let waiter = {
            let l = l.clone();
            tokio::spawn(async move { l.acquire(8_000_000).await })
        };
        tokio::time::sleep(Duration::from_secs(1)).await;
        l.set_rate(4_000_000);
        waiter.await.unwrap();
        let secs = start.elapsed().as_secs_f64();
        assert!((2.4..3.3).contains(&secs), "took {secs}s");
    }

    #[tokio::test(start_paused = true)]
    async fn lowering_the_limit_lengthens_the_remaining_wait() {
        // 4 MB at 4 MB/s: 1 MB is free (burst), the 3 MB debt would take 0.75 s. After 0.5 s,
        // 1 MB of debt is left; dropping to 1 MB/s makes that take 1 s: ~1.5 s in total
        // instead of 0.75 s.
        let l = std::sync::Arc::new(RateLimiter::new(4_000_000));
        let start = Instant::now();
        let waiter = {
            let l = l.clone();
            tokio::spawn(async move { l.acquire(4_000_000).await })
        };
        tokio::time::sleep(Duration::from_millis(500)).await;
        l.set_rate(1_000_000);
        waiter.await.unwrap();
        let secs = start.elapsed().as_secs_f64();
        assert!((1.3..1.8).contains(&secs), "the lowered limit was not applied: {secs}s");
    }

    #[tokio::test(start_paused = true)]
    async fn oversized_request_is_paid_for_in_time() {
        // A single request larger than the bucket must still be limited (debt model).
        let l = RateLimiter::new(1_000_000);
        let t = Instant::now();
        l.acquire(3_000_000).await;
        let secs = t.elapsed().as_secs_f64();
        assert!((2.6..3.1).contains(&secs), "took {secs}s");
    }
}
