//! Segment planning and resume bookkeeping.
//!
//! A segment is an inclusive byte range `[start, end]` of the remote file. `downloaded` counts
//! how many bytes of it are already written to disk, so the next byte to fetch is
//! `start + downloaded`. This is everything needed to resume: no `.part` files exist.

use serde::{Deserialize, Serialize};

/// Never create segments smaller than this: below it the extra connection costs more than it saves.
pub const MIN_SEGMENT_SIZE: u64 = 1024 * 1024;

/// Work stealing never splits off a piece smaller than this (default; see `EngineConfig`).
pub const MIN_STEAL_SIZE: u64 = 256 * 1024;

/// `end` value used for a stream whose length is unknown.
pub const UNBOUNDED_END: u64 = u64::MAX;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Segment {
    pub index: u32,
    /// First byte (inclusive).
    pub start: u64,
    /// Last byte (inclusive), or [`UNBOUNDED_END`] for an unknown length.
    pub end: u64,
    /// Bytes of this segment already on disk.
    pub downloaded: u64,
}

impl Segment {
    pub fn is_bounded(&self) -> bool {
        self.end != UNBOUNDED_END
    }

    /// Total size of the segment in bytes.
    pub fn len(&self) -> u64 {
        if self.is_bounded() {
            self.end - self.start + 1
        } else {
            u64::MAX
        }
    }

    pub fn is_empty(&self) -> bool {
        self.is_bounded() && self.end < self.start
    }

    pub fn remaining(&self) -> u64 {
        self.len().saturating_sub(self.downloaded)
    }

    pub fn is_complete(&self) -> bool {
        self.is_bounded() && self.downloaded >= self.len()
    }

    /// File offset of the next byte to fetch.
    pub fn next_offset(&self) -> u64 {
        self.start + self.downloaded
    }

    /// The `Range` header value for what is still missing, or `None` if complete.
    pub fn remaining_range_header(&self) -> Option<String> {
        if self.is_complete() {
            None
        } else {
            Some(format!("bytes={}-{}", self.next_offset(), self.end))
        }
    }
}

/// Split `total` bytes into at most `connections` contiguous segments.
///
/// - Never produces a segment below [`MIN_SEGMENT_SIZE`] (small files use fewer connections).
/// - Sizes differ by at most one byte; the first `total % n` segments get the extra byte.
/// - `total == 0` gives no segments.
pub fn split(total: u64, connections: u32) -> Vec<Segment> {
    if total == 0 {
        return Vec::new();
    }
    let wanted = connections.max(1) as u64;
    let by_size = (total / MIN_SEGMENT_SIZE).max(1);
    let n = wanted.min(by_size);

    let base = total / n;
    let extra = total % n;
    let mut segments = Vec::with_capacity(n as usize);
    let mut start = 0u64;
    for i in 0..n {
        let len = base + if i < extra { 1 } else { 0 };
        segments.push(Segment {
            index: i as u32,
            start,
            end: start + len - 1,
            downloaded: 0,
        });
        start += len;
    }
    segments
}

/// One segment covering the whole file for servers without range support.
/// `total == None` means the length is unknown.
pub fn single(total: Option<u64>) -> Segment {
    Segment {
        index: 0,
        start: 0,
        end: match total {
            Some(t) if t > 0 => t - 1,
            _ => UNBOUNDED_END,
        },
        downloaded: 0,
    }
}

/// Check that persisted segments really describe a file of `total` bytes: once ordered by
/// position they are contiguous and cover `[0, total)`, ids are unique, and `downloaded`
/// never exceeds a segment's length. (With work stealing segments are created and shrunk while
/// downloading, so ids are not positions and the list need not be stored in order.)
pub fn is_consistent(segments: &[Segment], total: u64) -> bool {
    if segments.is_empty() {
        return false;
    }
    let mut sorted: Vec<&Segment> = segments.iter().collect();
    sorted.sort_by_key(|s| s.start);
    let mut ids: Vec<u32> = sorted.iter().map(|s| s.index).collect();
    ids.sort_unstable();
    ids.dedup();
    if ids.len() != sorted.len() {
        return false;
    }
    let mut expected_start = 0u64;
    for s in sorted {
        if !s.is_bounded() || s.start != expected_start || s.end < s.start || s.downloaded > s.len() {
            return false;
        }
        expected_start = s.end + 1;
    }
    expected_start == total
}

/// Total bytes downloaded across all segments.
pub fn total_downloaded(segments: &[Segment]) -> u64 {
    segments.iter().map(|s| s.downloaded.min(s.len())).sum()
}

/// Segments that still need work.
pub fn incomplete(segments: &[Segment]) -> impl Iterator<Item = &Segment> {
    segments.iter().filter(|s| !s.is_complete())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_partition(segs: &[Segment], total: u64) {
        assert!(!segs.is_empty());
        assert_eq!(segs[0].start, 0);
        assert_eq!(segs.last().unwrap().end, total - 1);
        for w in segs.windows(2) {
            assert_eq!(w[0].end + 1, w[1].start, "gap or overlap between segments");
        }
        let sum: u64 = segs.iter().map(|s| s.len()).sum();
        assert_eq!(sum, total);
        for (i, s) in segs.iter().enumerate() {
            assert_eq!(s.index as usize, i);
            assert_eq!(s.downloaded, 0);
        }
    }

    #[test]
    fn splits_evenly() {
        let total = 8 * MIN_SEGMENT_SIZE;
        let segs = split(total, 8);
        assert_eq!(segs.len(), 8);
        assert_partition(&segs, total);
        assert!(segs.iter().all(|s| s.len() == MIN_SEGMENT_SIZE));
    }

    #[test]
    fn remainder_goes_to_first_segments_and_sizes_differ_by_at_most_one() {
        let total = 10 * MIN_SEGMENT_SIZE + 3;
        let segs = split(total, 4);
        assert_partition(&segs, total);
        let min = segs.iter().map(|s| s.len()).min().unwrap();
        let max = segs.iter().map(|s| s.len()).max().unwrap();
        assert!(max - min <= 1);
        // The 3 extra bytes are spread over the first three segments.
        assert_eq!(segs[0].len(), max);
        assert_eq!(segs[3].len(), min);
    }

    #[test]
    fn small_files_use_fewer_connections() {
        // 2.5 MiB with a 1 MiB minimum -> at most 2 segments, even if 8 were requested.
        let total = 2 * MIN_SEGMENT_SIZE + MIN_SEGMENT_SIZE / 2;
        let segs = split(total, 8);
        assert_eq!(segs.len(), 2);
        assert_partition(&segs, total);
    }

    #[test]
    fn tiny_file_is_one_segment() {
        let segs = split(10, 8);
        assert_eq!(segs.len(), 1);
        assert_eq!((segs[0].start, segs[0].end), (0, 9));
        let segs = split(1, 32);
        assert_eq!(segs.len(), 1);
        assert_eq!((segs[0].start, segs[0].end), (0, 0));
    }

    #[test]
    fn zero_bytes_gives_no_segments() {
        assert!(split(0, 8).is_empty());
    }

    #[test]
    fn one_connection_is_one_segment() {
        let total = 100 * MIN_SEGMENT_SIZE;
        let segs = split(total, 1);
        assert_eq!(segs.len(), 1);
        assert_partition(&segs, total);
        // Zero is treated as one.
        assert_eq!(split(total, 0).len(), 1);
    }

    #[test]
    fn max_connections_on_a_large_file() {
        let total = 1u64 << 30; // 1 GiB
        let segs = split(total, 32);
        assert_eq!(segs.len(), 32);
        assert_partition(&segs, total);
    }

    #[test]
    fn handles_sizes_beyond_4gb() {
        let total = 6 * (1u64 << 30) + 12345;
        let segs = split(total, 8);
        assert_eq!(segs.len(), 8);
        assert_partition(&segs, total);
        assert!(segs.last().unwrap().end > u32::MAX as u64);
    }

    #[test]
    fn partition_holds_for_many_sizes_and_counts() {
        for total in [1u64, 7, 1023, MIN_SEGMENT_SIZE, MIN_SEGMENT_SIZE + 1, 5_000_001, 123_456_789] {
            for conns in 1..=32u32 {
                let segs = split(total, conns);
                assert_partition(&segs, total);
                assert!(segs.len() as u32 <= conns);
            }
        }
    }

    #[test]
    fn range_header_covers_only_what_is_missing() {
        let mut s = Segment { index: 0, start: 100, end: 199, downloaded: 0 };
        assert_eq!(s.remaining_range_header().as_deref(), Some("bytes=100-199"));
        s.downloaded = 40;
        assert_eq!(s.next_offset(), 140);
        assert_eq!(s.remaining(), 60);
        assert_eq!(s.remaining_range_header().as_deref(), Some("bytes=140-199"));
        s.downloaded = 100;
        assert!(s.is_complete());
        assert_eq!(s.remaining_range_header(), None);
    }

    #[test]
    fn consistency_check_accepts_valid_and_rejects_broken_state() {
        let total = 4 * MIN_SEGMENT_SIZE;
        let mut segs = split(total, 4);
        segs[1].downloaded = 1000;
        assert!(is_consistent(&segs, total));
        assert_eq!(total_downloaded(&segs), 1000);

        // Wrong total.
        assert!(!is_consistent(&segs, total + 1));
        // Progress beyond the segment length.
        let mut bad = segs.clone();
        bad[0].downloaded = bad[0].len() + 1;
        assert!(!is_consistent(&bad, total));
        // Gap between segments.
        let mut bad = segs.clone();
        bad[2].start += 1;
        assert!(!is_consistent(&bad, total));
        // Empty / unbounded.
        assert!(!is_consistent(&[], total));
        assert!(!is_consistent(&[single(None)], total));
        // Duplicate ids.
        let mut bad = segs.clone();
        bad[1].index = bad[0].index;
        assert!(!is_consistent(&bad, total));
    }

    #[test]
    fn consistency_allows_work_stealing_layouts() {
        // After stealing: ids are not positions, and the stored order may differ from file order.
        let segs = vec![
            Segment { index: 0, start: 0, end: 99, downloaded: 10 },
            Segment { index: 5, start: 150, end: 199, downloaded: 0 },
            Segment { index: 3, start: 100, end: 149, downloaded: 50 },
        ];
        assert!(is_consistent(&segs, 200));
        assert_eq!(total_downloaded(&segs), 60);
    }

    #[test]
    fn incomplete_lists_only_unfinished_segments() {
        let total = 4 * MIN_SEGMENT_SIZE;
        let mut segs = split(total, 4);
        segs[0].downloaded = segs[0].len();
        segs[2].downloaded = segs[2].len();
        segs[3].downloaded = 5;
        let idx: Vec<u32> = incomplete(&segs).map(|s| s.index).collect();
        assert_eq!(idx, vec![1, 3]);
    }

    #[test]
    fn single_segment_for_unknown_and_known_length() {
        let s = single(None);
        assert!(!s.is_bounded());
        assert!(!s.is_complete());
        let s = single(Some(500));
        assert_eq!((s.start, s.end), (0, 499));
    }
}
