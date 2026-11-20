//! Direct, offset-addressed file writing.
//!
//! The destination file is created at its final size up front, and every segment writes straight
//! into it at its own byte offset (`seek_write` on Windows, `write_at` on Unix). There are no
//! `.part` files and no merge step at the end.

use std::fs::{File, OpenOptions};
use std::io;
use std::path::Path;
use std::sync::Arc;

use tokio::sync::{mpsc, oneshot};

use crate::table::SegState;

/// A shared handle that many threads may write to concurrently, each at its own offset.
#[derive(Clone)]
pub struct OffsetFile {
    file: Arc<File>,
}

impl OffsetFile {
    /// Create (truncating anything already there). With `preallocate = Some(n)` the file is
    /// extended to `n` bytes immediately, so a full disk is detected before the download starts.
    pub fn create(path: &Path, preallocate: Option<u64>) -> io::Result<Self> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .open(path)?;
        if let Some(n) = preallocate {
            file.set_len(n)?;
        }
        Ok(Self { file: Arc::new(file) })
    }

    /// Open a partially downloaded file for resuming. It must already have its full length;
    /// anything else means the file was tampered with or truncated, so we refuse.
    pub fn open_existing(path: &Path, expected_len: u64) -> io::Result<Self> {
        let file = OpenOptions::new().read(true).write(true).open(path)?;
        let len = file.metadata()?.len();
        if len != expected_len {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("partial file has length {len}, expected {expected_len}"),
            ));
        }
        Ok(Self { file: Arc::new(file) })
    }

    /// Write all of `buf` at `offset`. Safe to call from several threads at once.
    pub fn write_all_at(&self, mut offset: u64, mut buf: &[u8]) -> io::Result<()> {
        while !buf.is_empty() {
            let n = write_at(&self.file, buf, offset)?;
            if n == 0 {
                return Err(io::Error::new(io::ErrorKind::WriteZero, "failed to write data"));
            }
            buf = &buf[n..];
            offset += n as u64;
        }
        Ok(())
    }

    /// Flush file data to stable storage. Called before progress is checkpointed, so that the
    /// recorded progress never claims bytes that a power cut could still lose.
    pub fn sync(&self) -> io::Result<()> {
        self.file.sync_data()
    }

    pub fn set_len(&self, len: u64) -> io::Result<()> {
        self.file.set_len(len)
    }

    pub fn len(&self) -> io::Result<u64> {
        Ok(self.file.metadata()?.len())
    }

    pub fn is_empty(&self) -> io::Result<bool> {
        Ok(self.len()? == 0)
    }
}

/// How many 1 MiB-class blocks may wait for the disk before connections have to wait (back-pressure:
/// a slow disk slows the network down instead of filling memory).
const WRITE_QUEUE_BLOCKS: usize = 48;

/// One block to write. The writer advances the segment's `written` counter **after** the data was
/// handed to the OS, which is what keeps "persisted progress <= bytes on disk" true.
struct WriteJob {
    at: u64,
    data: Vec<u8>,
    seg: Arc<SegState>,
    done: oneshot::Sender<io::Result<()>>,
}

/// The dedicated writer: one OS thread per download that performs every disk write, in the order
/// the blocks arrive. Connections never touch the file; they queue blocks and carry on reading the
/// network. (Replaces one `spawn_blocking` per flush, which competed with everything else for the
/// blocking pool and made the writes of different connections interleave arbitrarily.)
///
/// The thread ends by itself when the last clone of the `DiskWriter` is dropped.
#[derive(Clone)]
pub struct DiskWriter {
    tx: mpsc::Sender<WriteJob>,
}

impl DiskWriter {
    pub fn spawn(file: OffsetFile) -> Self {
        let (tx, mut rx) = mpsc::channel::<WriteJob>(WRITE_QUEUE_BLOCKS);
        std::thread::Builder::new()
            .name("flowget-disk-writer".into())
            .spawn(move || {
                while let Some(job) = rx.blocking_recv() {
                    let n = job.data.len() as u64;
                    let result = file.write_all_at(job.at, &job.data);
                    if result.is_ok() {
                        job.seg.add_written(n);
                    }
                    let _ = job.done.send(result);
                }
            })
            .expect("could not start the disk writer thread");
        Self { tx }
    }

    /// Queue a block. The returned receiver resolves once the block is on its way to the disk
    /// (written to the OS) and the segment's counter has been advanced.
    pub async fn submit(
        &self,
        at: u64,
        data: Vec<u8>,
        seg: Arc<SegState>,
    ) -> io::Result<oneshot::Receiver<io::Result<()>>> {
        let (done, rx) = oneshot::channel();
        self.tx
            .send(WriteJob { at, data, seg, done })
            .await
            .map_err(|_| io::Error::new(io::ErrorKind::BrokenPipe, "the disk writer stopped"))?;
        Ok(rx)
    }
}

#[cfg(windows)]
fn write_at(file: &File, buf: &[u8], offset: u64) -> io::Result<usize> {
    use std::os::windows::fs::FileExt;
    file.seek_write(buf, offset)
}

#[cfg(unix)]
fn write_at(file: &File, buf: &[u8], offset: u64) -> io::Result<usize> {
    use std::os::unix::fs::FileExt;
    file.write_at(buf, offset)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    /// Deterministic content so we can tell exactly which byte landed where.
    fn pattern(len: usize) -> Vec<u8> {
        (0..len).map(|i| (i.wrapping_mul(31).wrapping_add(7) % 251) as u8).collect()
    }

    #[test]
    fn preallocates_to_final_size() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("f.bin");
        let f = OffsetFile::create(&p, Some(10_000)).unwrap();
        assert_eq!(f.len().unwrap(), 10_000);
        assert_eq!(std::fs::metadata(&p).unwrap().len(), 10_000);
    }

    #[test]
    fn writes_land_at_the_requested_offset() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("f.bin");
        let f = OffsetFile::create(&p, Some(100)).unwrap();
        f.write_all_at(40, b"HELLO").unwrap();
        f.write_all_at(0, b"AB").unwrap();
        f.write_all_at(98, b"YZ").unwrap();
        let data = std::fs::read(&p).unwrap();
        assert_eq!(data.len(), 100);
        assert_eq!(&data[40..45], b"HELLO");
        assert_eq!(&data[0..2], b"AB");
        assert_eq!(&data[98..100], b"YZ");
        // Bytes nobody wrote stay zero.
        assert!(data[2..40].iter().all(|&b| b == 0));
    }

    #[test]
    fn out_of_order_segment_writes_reassemble_the_original() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("f.bin");
        let original = pattern(1_000_003);
        let f = OffsetFile::create(&p, Some(original.len() as u64)).unwrap();

        // Cut into uneven pieces and write them in reverse order.
        let cuts = [0usize, 1, 4096, 250_000, 500_001, 999_999, original.len()];
        for w in cuts.windows(2).rev() {
            f.write_all_at(w[0] as u64, &original[w[0]..w[1]]).unwrap();
        }
        assert_eq!(std::fs::read(&p).unwrap(), original);
    }

    #[test]
    fn concurrent_writers_do_not_clobber_each_other() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("f.bin");
        let original = pattern(8 * 65_536 + 123);
        let f = OffsetFile::create(&p, Some(original.len() as u64)).unwrap();

        let seg = original.len() / 8;
        let mut handles = Vec::new();
        for i in 0..8 {
            let f = f.clone();
            let start = i * seg;
            let end = if i == 7 { original.len() } else { start + seg };
            let chunk = original[start..end].to_vec();
            handles.push(thread::spawn(move || {
                // Each "segment" writes in small pieces, like a network loop would.
                let mut off = start;
                for piece in chunk.chunks(1000) {
                    f.write_all_at(off as u64, piece).unwrap();
                    off += piece.len();
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
        assert_eq!(std::fs::read(&p).unwrap(), original);
    }

    #[test]
    fn open_existing_keeps_data_and_checks_length() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("f.bin");
        {
            let f = OffsetFile::create(&p, Some(50)).unwrap();
            f.write_all_at(10, b"keep me").unwrap();
            f.sync().unwrap();
        }
        // Resume: data survives, and we can keep writing.
        let f = OffsetFile::open_existing(&p, 50).unwrap();
        f.write_all_at(30, b"more").unwrap();
        let data = std::fs::read(&p).unwrap();
        assert_eq!(&data[10..17], b"keep me");
        assert_eq!(&data[30..34], b"more");

        // A file of the wrong size is rejected.
        assert!(OffsetFile::open_existing(&p, 51).is_err());
        // Missing file is rejected.
        assert!(OffsetFile::open_existing(&dir.path().join("nope"), 1).is_err());
    }

    #[tokio::test]
    async fn the_disk_writer_writes_blocks_in_place_and_counts_them_only_after_writing() {
        use crate::segments::Segment;
        use crate::table::SegmentTable;
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("f.bin");
        let f = OffsetFile::create(&p, Some(100)).unwrap();
        let table = SegmentTable::new(&[Segment { index: 0, start: 0, end: 99, downloaded: 0 }], true);
        let seg = table.all()[0].clone();
        let w = DiskWriter::spawn(f.clone());
        // Queue out of order; both complete, each counted exactly once.
        let b = w.submit(40, vec![2u8; 60], seg.clone()).await.unwrap();
        let a = w.submit(0, vec![1u8; 40], seg.clone()).await.unwrap();
        a.await.unwrap().unwrap();
        b.await.unwrap().unwrap();
        assert_eq!(seg.written(), 100);
        let bytes = std::fs::read(&p).unwrap();
        assert!(bytes[..40].iter().all(|&x| x == 1) && bytes[40..].iter().all(|&x| x == 2));
    }

    #[test]
    fn create_truncates_old_content() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("f.bin");
        std::fs::write(&p, vec![9u8; 500]).unwrap();
        let f = OffsetFile::create(&p, None).unwrap();
        assert_eq!(f.len().unwrap(), 0);
    }
}
