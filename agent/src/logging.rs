//! Log lines go to the terminal, or to a file when running as a Windows service (no console).

use std::fs::File;
#[cfg(windows)]
use std::fs::{self, OpenOptions};
use std::io::Write;
#[cfg(windows)]
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

static FILE: OnceLock<Mutex<File>> = OnceLock::new();
/// Start a fresh log when the old one passes this size (the previous one is kept as .old).
#[cfg(windows)]
const MAX_BYTES: u64 = 5 * 1024 * 1024;

/// Send all further log lines to `path` (Windows service only; Linux logs to the terminal).
#[cfg(windows)]
pub fn to_file(path: &Path) -> std::io::Result<()> {
    if fs::metadata(path)
        .map(|m| m.len() > MAX_BYTES)
        .unwrap_or(false)
    {
        let _ = fs::rename(path, path.with_extension("log.old"));
    }
    let file = OpenOptions::new().create(true).append(true).open(path)?;
    let _ = FILE.set(Mutex::new(file));
    Ok(())
}

pub fn write(line: &str, is_error: bool) {
    match FILE.get() {
        Some(file) => {
            let secs = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            if let Ok(mut f) = file.lock() {
                let _ = writeln!(f, "{secs} {}{line}", if is_error { "ERROR " } else { "" });
            }
        }
        None if is_error => eprintln!("{line}"),
        None => println!("{line}"),
    }
}

/// Normal log line.
#[macro_export]
macro_rules! say {
    ($($arg:tt)*) => { $crate::logging::write(&format!($($arg)*), false) };
}

/// Error log line.
#[macro_export]
macro_rules! warn {
    ($($arg:tt)*) => { $crate::logging::write(&format!($($arg)*), true) };
}
