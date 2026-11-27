//! Free space of the drive that will receive a download, so a file that cannot fit is refused up front
//! with a clear message instead of failing later (or half way) with a generic disk error.

use std::path::Path;

/// Bytes the current user can still write on the drive holding `dir`.
/// `None` when it cannot be read (unknown platform, network share without the information, ...):
/// the caller then simply skips the check.
pub fn free_space(dir: &Path) -> Option<u64> {
    imp::free_space(dir)
}

/// "80.0 GB", "162 MB", ... for messages shown to people.
pub fn human_bytes(n: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut v = n as f64;
    let mut i = 0;
    while v >= 1024.0 && i < UNITS.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    if i == 0 {
        format!("{n} B")
    } else if v >= 100.0 {
        format!("{:.0} {}", v, UNITS[i])
    } else {
        format!("{:.1} {}", v, UNITS[i])
    }
}

/// The drive letter / root of `path` for messages, e.g. `D:\`.
pub fn drive_label(path: &Path) -> String {
    use std::path::Component;
    match path.components().next() {
        Some(Component::Prefix(p)) => format!("{}\\", p.as_os_str().to_string_lossy()),
        _ => "the disk".to_string(),
    }
}

#[cfg(windows)]
mod imp {
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;

    // Declared here instead of pulling in another windows-sys feature just for one call.
    #[link(name = "kernel32")]
    extern "system" {
        fn GetDiskFreeSpaceExW(
            lp_directory_name: *const u16,
            lp_free_bytes_available_to_caller: *mut u64,
            lp_total_number_of_bytes: *mut u64,
            lp_total_number_of_free_bytes: *mut u64,
        ) -> i32;
    }

    pub fn free_space(dir: &Path) -> Option<u64> {
        let mut wide: Vec<u16> = dir.as_os_str().encode_wide().collect();
        wide.push(0);
        let mut free_to_caller: u64 = 0;
        let mut total: u64 = 0;
        let mut total_free: u64 = 0;
        // SAFETY: `wide` is a NUL-terminated UTF-16 string that outlives the call and the three
        // out-pointers are valid for writes.
        let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut free_to_caller, &mut total, &mut total_free) };
        if ok != 0 {
            Some(free_to_caller)
        } else {
            None
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use std::path::Path;

    pub fn free_space(_dir: &Path) -> Option<u64> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_sizes_for_people() {
        assert_eq!(human_bytes(0), "0 B");
        assert_eq!(human_bytes(1023), "1023 B");
        assert_eq!(human_bytes(162 * 1024 * 1024), "162 MB");
        assert_eq!(human_bytes(80 * 1024 * 1024 * 1024), "80.0 GB");
        assert_eq!(human_bytes(1536 * 1024), "1.5 MB");
    }

    #[test]
    fn names_the_drive() {
        #[cfg(windows)]
        assert_eq!(drive_label(Path::new(r"D:\Downloads\x.exe")), r"D:\");
        assert_eq!(drive_label(Path::new("")), "the disk");
    }

    #[cfg(windows)]
    #[test]
    fn reads_free_space_of_a_real_directory() {
        let free = free_space(&std::env::temp_dir()).expect("temp dir's drive is readable");
        assert!(free > 0);
    }

    #[cfg(windows)]
    #[test]
    fn a_missing_directory_is_unknown_not_zero() {
        assert_eq!(free_space(Path::new(r"Z:\definitely\not\here\at\all")), None);
    }
}
