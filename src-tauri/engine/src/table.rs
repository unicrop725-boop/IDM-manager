//! The live segment table: the shared, *changing* set of byte ranges of one download.
//!
//! Work stealing (Phase 2) means segments are created and shrunk while the download runs: when a
//! connection runs out of work it splits the remainder of the slowest segment in half and starts
//! a new connection on the second half.
//!
//! Safety of splitting: a connection never reads bytes it has not first **claimed** from its
//! segment via [`SegState::claim`], and a split happens under the same per-segment lock. So the
//! split point is always at or beyond the last claimed byte and no byte is ever fetched by two
//! connections (checked by the concurrency test below).

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Instant;

use tokio_util::sync::CancellationToken;

use crate::segments::{Segment, UNBOUNDED_END};

struct Pos {
    /// Last byte (inclusive) this segment owns; shrinks when part of it is stolen.
    end: u64,
    /// Next byte the connection will claim. Always `start + written <= fetch_pos <= end + 1`.
    fetch_pos: u64,
    /// Cancelling this closes the current connection of the segment ("close it and reopen").
    abort: CancellationToken,
}

/// One segment: a byte range, how much of it is on disk, and live statistics.
pub struct SegState {
    pub id: u32,
    pub start: u64,
    pos: Mutex<Pos>,
    /// Bytes of this segment written to the file (flushed).
    written: AtomicU64,
    /// A connection is currently assigned to this segment.
    running: AtomicBool,
    /// The segment's connection has reached its end.
    finished: AtomicBool,
    /// Bytes received from the network, across reconnects (for speed measurement).
    rx_total: AtomicU64,
    /// Table-relative millisecond timestamp of the last received chunk.
    last_rx_ms: AtomicU64,
    /// The connection is deliberately idle (speed limiter wait, retry backoff): not a stall.
    exempt: AtomicBool,
    /// Smoothed speed in bytes/s, maintained by the monitor loop.
    speed: AtomicU64,
    /// Do not restart before this table time (used to damp repeated stall restarts).
    not_before_ms: AtomicU64,
    /// `Retry-After` hint from the server (ms), 0 = none.
    retry_after_ms: AtomicU64,
}

impl SegState {
    fn new(id: u32, start: u64, end: u64, written: u64) -> Self {
        Self {
            id,
            start,
            pos: Mutex::new(Pos { end, fetch_pos: start + written, abort: CancellationToken::new() }),
            written: AtomicU64::new(written),
            running: AtomicBool::new(false),
            finished: AtomicBool::new(false),
            rx_total: AtomicU64::new(0),
            last_rx_ms: AtomicU64::new(0),
            exempt: AtomicBool::new(false),
            speed: AtomicU64::new(0),
            not_before_ms: AtomicU64::new(0),
            retry_after_ms: AtomicU64::new(0),
        }
    }

    pub fn end(&self) -> u64 {
        self.pos.lock().unwrap().end
    }

    /// Exclusive upper bound for fetching, `u64::MAX` for streams of unknown length.
    pub fn limit(&self) -> u64 {
        let e = self.end();
        if e == UNBOUNDED_END {
            u64::MAX
        } else {
            e + 1
        }
    }

    pub fn written(&self) -> u64 {
        self.written.load(Ordering::SeqCst)
    }

    pub fn add_written(&self, n: u64) {
        self.written.fetch_add(n, Ordering::SeqCst);
    }

    pub fn is_complete(&self) -> bool {
        if self.finished.load(Ordering::SeqCst) {
            return true;
        }
        let end = self.end();
        end != UNBOUNDED_END && self.written() > end - self.start
    }

    /// The connection reached the end of this segment (also how streams of unknown length end).
    pub fn mark_finished(&self) {
        self.finished.store(true, Ordering::SeqCst);
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    pub fn set_running(&self, v: bool) {
        self.running.store(v, Ordering::SeqCst);
    }

    /// Begin a (re)connection. Returns the file offset to request from and a token that the
    /// monitor can cancel to close just this connection, or `None` if nothing is left to fetch.
    /// `restart = true` (servers without range support) starts over from byte 0.
    pub fn begin_attempt(
        &self,
        parent: &CancellationToken,
        restart: bool,
        now_ms: u64,
    ) -> Option<(u64, CancellationToken)> {
        let mut g = self.pos.lock().unwrap();
        if restart {
            self.written.store(0, Ordering::SeqCst);
        }
        let offset = self.start + self.written();
        if g.end != UNBOUNDED_END && offset > g.end {
            return None;
        }
        // Bytes claimed by a failed attempt but never written must be fetched again.
        g.fetch_pos = offset;
        g.abort = parent.child_token();
        self.last_rx_ms.store(now_ms, Ordering::Relaxed);
        Some((offset, g.abort.clone()))
    }

    /// Close this segment's current connection (the worker returns `Aborted`).
    pub fn abort_connection(&self) {
        self.pos.lock().unwrap().abort.cancel();
    }

    /// Claim up to `want` bytes at the current fetch position. Returns `(offset, granted)`;
    /// `granted == 0` means the segment's end (possibly just shrunk by a steal) was reached.
    pub fn claim(&self, want: u64) -> (u64, u64) {
        let mut g = self.pos.lock().unwrap();
        let limit = if g.end == UNBOUNDED_END { u64::MAX } else { g.end + 1 };
        let n = want.min(limit.saturating_sub(g.fetch_pos));
        let offset = g.fetch_pos;
        g.fetch_pos += n;
        (offset, n)
    }

    pub fn note_rx(&self, n: u64, now_ms: u64) {
        self.rx_total.fetch_add(n, Ordering::Relaxed);
        self.last_rx_ms.store(now_ms, Ordering::Relaxed);
    }

    pub fn rx_total(&self) -> u64 {
        self.rx_total.load(Ordering::Relaxed)
    }

    pub fn last_rx_ms(&self) -> u64 {
        self.last_rx_ms.load(Ordering::Relaxed)
    }

    /// Start a period where this connection is deliberately not receiving (waiting for the speed
    /// limiter, writing to disk, backing off): the stall detector ignores it.
    pub fn begin_idle(&self) {
        self.exempt.store(true, Ordering::Relaxed);
    }

    /// End an idle period. The stall clock restarts *now*: time spent idle (for instance while a
    /// slow disk finished a write) must not count towards "no data for N seconds".
    pub fn end_idle(&self, now_ms: u64) {
        self.last_rx_ms.store(now_ms, Ordering::Relaxed);
        self.exempt.store(false, Ordering::Relaxed);
    }

    pub fn is_exempt(&self) -> bool {
        self.exempt.load(Ordering::Relaxed)
    }

    pub fn speed(&self) -> u64 {
        self.speed.load(Ordering::Relaxed)
    }

    pub fn set_speed(&self, bps: u64) {
        self.speed.store(bps, Ordering::Relaxed);
    }

    pub fn set_not_before(&self, ms: u64) {
        self.not_before_ms.store(ms, Ordering::Relaxed);
    }

    pub fn set_retry_after_ms(&self, ms: u64) {
        self.retry_after_ms.store(ms, Ordering::Relaxed);
    }

    /// Take (and clear) the server's `Retry-After` hint.
    pub fn take_retry_after_ms(&self) -> u64 {
        self.retry_after_ms.swap(0, Ordering::Relaxed)
    }

    /// Bytes not yet claimed by a connection (`end + 1 - fetch_pos`); 0 for unbounded segments.
    pub fn unclaimed(&self) -> u64 {
        let g = self.pos.lock().unwrap();
        if g.end == UNBOUNDED_END {
            0
        } else {
            (g.end + 1).saturating_sub(g.fetch_pos)
        }
    }

    fn to_segment(&self) -> Segment {
        Segment { index: self.id, start: self.start, end: self.end(), downloaded: self.written() }
    }
}

pub struct SegmentTable {
    segs: RwLock<Vec<Arc<SegState>>>,
    next_id: AtomicU32,
    epoch: Instant,
    /// Whether the server supports ranges. Stealing and partial resume need it.
    pub ranged: bool,
}

impl SegmentTable {
    pub fn new(segments: &[Segment], ranged: bool) -> Self {
        let states: Vec<Arc<SegState>> = segments
            .iter()
            .map(|s| Arc::new(SegState::new(s.index, s.start, s.end, s.downloaded)))
            .collect();
        let next = segments.iter().map(|s| s.index + 1).max().unwrap_or(0);
        Self { segs: RwLock::new(states), next_id: AtomicU32::new(next), epoch: Instant::now(), ranged }
    }

    pub fn now_ms(&self) -> u64 {
        self.epoch.elapsed().as_millis() as u64
    }

    pub fn all(&self) -> Vec<Arc<SegState>> {
        self.segs.read().unwrap().clone()
    }

    pub fn running_count(&self) -> usize {
        self.all().iter().filter(|s| s.is_running()).count()
    }

    /// Persistable view, ordered by file position.
    ///
    /// Taken under the list lock, and a steal changes the layout under the *write* lock, so a
    /// snapshot always shows a complete layout (never "victim already shrunk, thief not yet
    /// listed", which would look like a hole in the file and make a saved record unusable).
    pub fn snapshot(&self) -> Vec<Segment> {
        let list = self.segs.read().unwrap();
        let mut v: Vec<Segment> = list.iter().map(|s| s.to_segment()).collect();
        v.sort_by_key(|s| s.start);
        v
    }

    pub fn total_written(&self) -> u64 {
        self.all().iter().map(|s| s.written()).sum()
    }

    /// Claim a segment that has work left but no connection (never started, parked by a
    /// connection-count reduction, or closed after a stall). Marks it running.
    pub fn next_unstarted(&self) -> Option<Arc<SegState>> {
        let now = self.now_ms();
        for s in self.all() {
            if s.is_running() || s.is_complete() || s.not_before_ms.load(Ordering::Relaxed) > now {
                continue;
            }
            if s.running.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_ok() {
                return Some(s);
            }
        }
        None
    }

    /// Work stealing: pick the running segment that will take longest to finish (most bytes left
    /// relative to its speed), split its unclaimed remainder in half, and return the new segment
    /// (already marked running) for the caller to start a connection on.
    ///
    /// Only splits when both halves are at least `min_split` bytes.
    pub fn steal(&self, min_split: u64) -> Option<Arc<SegState>> {
        if !self.ranged {
            return None;
        }
        // Hold the list's write lock for the whole operation (see `snapshot`).
        let mut list = self.segs.write().unwrap();
        let running: Vec<Arc<SegState>> = list.iter().filter(|s| s.is_running()).cloned().collect();
        let known: Vec<u64> = running.iter().map(|s| s.speed()).filter(|&v| v > 0).collect();
        let avg = if known.is_empty() { 1_000_000 } else { known.iter().sum::<u64>() / known.len() as u64 };

        // Estimated time to finish = remaining / speed. Unknown speeds count as average.
        let mut best: Option<(f64, Arc<SegState>)> = None;
        for s in &running {
            let remaining = s.unclaimed();
            if remaining < min_split.saturating_mul(2) {
                continue;
            }
            let speed = if s.speed() == 0 { avg } else { s.speed() }.max(1);
            let eta = remaining as f64 / speed as f64;
            if best.as_ref().is_none_or(|(b, _)| eta > *b) {
                best = Some((eta, s.clone()));
            }
        }
        let (_, victim) = best?;

        // Split under the victim's lock: it keeps [fetch_pos, split), the thief gets [split, end].
        let (split, old_end) = {
            let mut g = victim.pos.lock().unwrap();
            if g.end == UNBOUNDED_END {
                return None;
            }
            let remaining = (g.end + 1).saturating_sub(g.fetch_pos);
            if remaining < min_split.saturating_mul(2) {
                return None; // it advanced since we looked
            }
            let split = g.fetch_pos + remaining / 2;
            let old_end = g.end;
            g.end = split - 1;
            (split, old_end)
        };
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let thief = Arc::new(SegState::new(id, split, old_end, 0));
        thief.set_running(true);
        list.push(thief.clone());
        Some(thief)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::segments::{self, MIN_STEAL_SIZE};
    use std::thread;

    const KIB: u64 = 1024;

    fn table(total: u64, conns: u32) -> SegmentTable {
        SegmentTable::new(&segments::split(total, conns), true)
    }

    fn start_all(t: &SegmentTable) {
        while t.next_unstarted().is_some() {}
    }

    #[test]
    fn next_unstarted_hands_out_each_segment_once() {
        let t = table(8 * 1024 * KIB, 4);
        let mut got = Vec::new();
        while let Some(s) = t.next_unstarted() {
            got.push(s.id);
        }
        got.sort();
        assert_eq!(got, vec![0, 1, 2, 3]);
        assert!(t.next_unstarted().is_none());
        // A segment whose connection ended is available again.
        t.all()[2].set_running(false);
        assert_eq!(t.next_unstarted().unwrap().id, 2);
    }

    #[test]
    fn next_unstarted_respects_restart_delay_and_skips_complete() {
        let t = table(2 * 1024 * KIB, 2);
        let all = t.all();
        all[0].set_not_before(t.now_ms() + 60_000);
        all[1].add_written(all[1].limit() - all[1].start); // already complete
        assert!(t.next_unstarted().is_none());
    }

    #[test]
    fn steal_splits_the_remainder_in_half_without_gaps() {
        let t = table(4 * 1024 * KIB, 1); // one segment, 4 MiB
        start_all(&t);
        let victim = t.all()[0].clone();
        let (off, n) = victim.claim(1000 * KIB);
        assert_eq!((off, n), (0, 1000 * KIB));

        let thief = t.steal(MIN_STEAL_SIZE).expect("enough left to split");
        let snap = t.snapshot();
        assert_eq!(snap.len(), 2);
        // Contiguous, covering everything.
        assert_eq!(snap[0].start, 0);
        assert_eq!(snap[0].end + 1, snap[1].start);
        assert_eq!(snap[1].end, 4 * 1024 * KIB - 1);
        assert_eq!(thief.start, snap[1].start);
        // Remainder after the victim's claim (3096 KiB) was halved.
        assert_eq!(victim.unclaimed(), 1548 * KIB);
        assert_eq!(thief.unclaimed(), 1548 * KIB);
        assert!(thief.is_running());
        assert!(segments::is_consistent(&snap, 4 * 1024 * KIB));
    }

    #[test]
    fn steal_respects_the_minimum_split_size() {
        // 600 KiB left -> two halves of 300 KiB, both >= 256 KiB: allowed.
        let t = table(600 * KIB, 1);
        start_all(&t);
        assert!(t.steal(MIN_STEAL_SIZE).is_some());
        let snap = t.snapshot();
        assert!(snap.iter().all(|s| s.len() >= MIN_STEAL_SIZE));

        // 500 KiB left -> halves of 250 KiB would be too small: refused.
        let t = table(500 * KIB, 1);
        start_all(&t);
        assert!(t.steal(MIN_STEAL_SIZE).is_none());
        assert_eq!(t.snapshot().len(), 1);

        // Exactly 2 x 256 KiB is allowed.
        let t = table(512 * KIB, 1);
        start_all(&t);
        assert!(t.steal(MIN_STEAL_SIZE).is_some());
    }

    #[test]
    fn steal_takes_from_the_slowest_with_the_most_left() {
        let t = table(8 * 1024 * KIB, 4); // 4 x 2 MiB
        start_all(&t);
        let segs = t.all();
        // Speeds in bytes/s; all have 2 MiB left. Segment 2 is by far the slowest.
        segs[0].set_speed(4_000_000);
        segs[1].set_speed(4_000_000);
        segs[2].set_speed(50_000);
        segs[3].set_speed(4_000_000);
        let thief = t.steal(MIN_STEAL_SIZE).unwrap();
        // The thief's range lies inside segment 2's original range [4 MiB, 6 MiB).
        assert!(thief.start > 4 * 1024 * KIB && thief.start < 6 * 1024 * KIB);
        assert_eq!(segs[2].end() + 1, thief.start);
        assert_eq!(segs[0].unclaimed(), 2 * 1024 * KIB, "others untouched");

        // Most bytes left wins when speeds are equal.
        let t = table(8 * 1024 * KIB, 4);
        start_all(&t);
        let segs = t.all();
        for s in &segs {
            s.set_speed(1_000_000);
        }
        segs[0].claim(500 * KIB);
        segs[1].claim(1500 * KIB); // segment 1 has only ~548 KiB left
        segs[2].claim(500 * KIB);
        // segment 3 is untouched: 2048 KiB left, the most of all
        let thief = t.steal(MIN_STEAL_SIZE).unwrap();
        assert!(thief.start > 6 * 1024 * KIB, "stole from segment 3, got start {}", thief.start);
    }

    #[test]
    fn steal_ignores_idle_complete_and_non_ranged() {
        let t = table(4 * 1024 * KIB, 2);
        // Nothing is running yet: nothing to steal from.
        assert!(t.steal(MIN_STEAL_SIZE).is_none());
        let t = SegmentTable::new(&segments::split(4 * 1024 * KIB, 2), false);
        start_all(&t);
        assert!(t.steal(MIN_STEAL_SIZE).is_none(), "no range support, no stealing");
    }

    #[test]
    fn begin_attempt_resets_unwritten_claims() {
        let t = table(1024 * KIB, 1);
        start_all(&t);
        let s = t.all()[0].clone();
        let parent = CancellationToken::new();
        let (off, _tok) = s.begin_attempt(&parent, false, 0).unwrap();
        assert_eq!(off, 0);
        s.claim(100); // claimed, then the connection died before writing
        s.add_written(40);
        let (off, _tok) = s.begin_attempt(&parent, false, 0).unwrap();
        assert_eq!(off, 40, "resumes at the first byte that is really on disk");
        assert_eq!(s.claim(1000 * KIB).0, 40);
    }

    #[test]
    fn begin_attempt_returns_none_when_complete() {
        let t = table(1000, 1);
        let s = t.all()[0].clone();
        s.add_written(1000);
        assert!(s.is_complete());
        assert!(s.begin_attempt(&CancellationToken::new(), false, 0).is_none());
    }

    #[test]
    fn abort_connection_cancels_only_the_current_attempt() {
        let t = table(1024 * KIB, 1);
        let s = t.all()[0].clone();
        let parent = CancellationToken::new();
        let (_, tok) = s.begin_attempt(&parent, false, 0).unwrap();
        s.abort_connection();
        assert!(tok.is_cancelled());
        assert!(!parent.is_cancelled());
        // The next attempt gets a fresh token.
        let (_, tok2) = s.begin_attempt(&parent, false, 0).unwrap();
        assert!(!tok2.is_cancelled());
        // Cancelling the parent cancels attempts too.
        parent.cancel();
        assert!(tok2.is_cancelled());
    }

    /// The invariant that makes stealing safe: while one connection keeps claiming bytes and
    /// others steal from it concurrently, every byte of the file is claimed exactly once.
    #[test]
    fn concurrent_claims_and_steals_cover_the_file_exactly_once() {
        const TOTAL: u64 = 96 * 1024 * KIB;
        for _round in 0..20 {
            let t = Arc::new(table(TOTAL, 1));
            start_all(&t);
            let claimed: Arc<Mutex<Vec<(u64, u64)>>> = Arc::new(Mutex::new(Vec::new()));

            let drain = |seg: Arc<SegState>, claimed: Arc<Mutex<Vec<(u64, u64)>>>| {
                thread::spawn(move || loop {
                    let (off, n) = seg.claim(7 * KIB + 13);
                    if n == 0 {
                        break;
                    }
                    claimed.lock().unwrap().push((off, n));
                })
            };

            let mut handles = vec![drain(t.all()[0].clone(), claimed.clone())];
            // Meanwhile, keep stealing and draining thieves.
            while let Some(thief) = t.steal(MIN_STEAL_SIZE) {
                handles.push(drain(thief, claimed.clone()));
                thread::yield_now();
            }
            for h in handles {
                h.join().unwrap();
            }

            let mut ranges = claimed.lock().unwrap().clone();
            ranges.sort();
            let mut next = 0;
            for (off, n) in ranges {
                assert_eq!(off, next, "gap or overlap at {off}");
                next = off + n;
            }
            assert_eq!(next, TOTAL, "file not fully covered");
            assert!(segments::is_consistent(&t.snapshot(), TOTAL));
        }
    }
}
