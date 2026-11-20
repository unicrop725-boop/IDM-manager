//! Speed smoothing and ETA.

use std::time::Instant;

/// Weight of the newest sample in the exponential moving average. At one sample every 250 ms
/// this gives a time constant of roughly one second: responsive but not jumpy.
const ALPHA: f64 = 0.3;

/// Smoothed speed (exponential moving average of the instantaneous rate).
pub struct SpeedMeter {
    ema: f64,
    last_bytes: u64,
    last_at: Instant,
    primed: bool,
}

impl SpeedMeter {
    pub fn new(initial_bytes: u64, now: Instant) -> Self {
        Self { ema: 0.0, last_bytes: initial_bytes, last_at: now, primed: false }
    }

    /// Feed the cumulative byte count; returns the smoothed speed in bytes per second.
    pub fn sample(&mut self, bytes: u64, now: Instant) -> f64 {
        let dt = now.saturating_duration_since(self.last_at).as_secs_f64();
        if dt <= 0.0 {
            return self.ema;
        }
        let instant = bytes.saturating_sub(self.last_bytes) as f64 / dt;
        self.ema = if self.primed {
            ALPHA * instant + (1.0 - ALPHA) * self.ema
        } else {
            self.primed = true;
            instant
        };
        self.last_bytes = bytes;
        self.last_at = now;
        self.ema
    }

    pub fn speed(&self) -> f64 {
        self.ema
    }
}

/// Seconds left at the current speed; `None` when the speed is too low to say.
pub fn eta_secs(remaining: u64, speed_bps: f64) -> Option<u64> {
    if speed_bps < 1.0 {
        None
    } else {
        Some((remaining as f64 / speed_bps).ceil() as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn first_sample_seeds_the_average() {
        let t0 = Instant::now();
        let mut m = SpeedMeter::new(0, t0);
        let s = m.sample(250_000, t0 + Duration::from_millis(250));
        assert!((s - 1_000_000.0).abs() < 1.0);
    }

    #[test]
    fn steady_rate_converges_and_spikes_are_smoothed() {
        let t0 = Instant::now();
        let mut m = SpeedMeter::new(0, t0);
        let mut bytes = 0u64;
        let mut t = t0;
        for _ in 0..40 {
            bytes += 100_000; // 400 KB/s
            t += Duration::from_millis(250);
            m.sample(bytes, t);
        }
        assert!((m.speed() - 400_000.0).abs() < 1_000.0);

        // One huge burst only moves the average by ALPHA of the jump.
        bytes += 4_000_000;
        t += Duration::from_millis(250);
        let s = m.sample(bytes, t);
        assert!(s < 400_000.0 + 0.31 * (16_000_000.0 - 400_000.0));
        assert!(s > 400_000.0);
    }

    #[test]
    fn speed_decays_when_transfer_stalls() {
        let t0 = Instant::now();
        let mut m = SpeedMeter::new(0, t0);
        let mut t = t0 + Duration::from_millis(250);
        m.sample(1_000_000, t); // 4 MB/s
        let start_speed = m.speed();
        let mut prev = start_speed;
        // 5 s with no data: each tick keeps 70 % of the average (0.7^20 = 0.08 %).
        for _ in 0..20 {
            t += Duration::from_millis(250);
            let s = m.sample(1_000_000, t);
            assert!(s < prev, "speed must keep falling while stalled");
            prev = s;
        }
        assert!(m.speed() < start_speed * 0.01);
    }

    #[test]
    fn eta() {
        assert_eq!(eta_secs(1_000_000, 100_000.0), Some(10));
        assert_eq!(eta_secs(1, 100_000.0), Some(1));
        assert_eq!(eta_secs(1_000, 0.0), None);
        assert_eq!(eta_secs(0, 500.0), Some(0));
    }
}
