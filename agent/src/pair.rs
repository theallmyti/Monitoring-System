//! Pairing (docs/Flow.md §3, FR-10–FR-12): get a 6-character code, show it as a QR code, wait
//! until the owner confirms it on the site or app. Codes last 10 minutes; an expired code is
//! replaced by a new one automatically, so pairing keeps working until it succeeds or is cancelled.
//!
//! Two front ends:
//! - Terminal: `pc-monitor-agent pair [config]` prints the QR code with block characters.
//! - Installer window: `pc-monitor-agent pair --ui <dir> [config]` writes `qr.bmp` (black on white)
//!   and `status.txt` into <dir> every second; the setup program shows them with a countdown.
//!   Creating `<dir>\cancel` stops it.
//!
//! QR: qrcode 0.14 (`QrCode::new`, `width`, `to_colors`, `render::<unicode::Dense1x2>()`).

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::exit;
use std::time::{Duration, Instant};

use convex::{ConvexClient, FunctionResult, Value};
use futures::StreamExt;
use qrcode::render::unicode;
use qrcode::{Color, QrCode};

/// What the QR code contains. The site and app scanners read the code after the prefix.
pub const QR_PREFIX: &str = "PCMONITOR-PAIR:";
/// FR-12: codes expire after 10 minutes.
const CODE_LIFETIME: Duration = Duration::from_secs(10 * 60);
/// QR image: pixels per module and the white margin (4 modules is the QR standard's quiet zone).
const MODULE_PX: usize = 8;
const QUIET_MODULES: usize = 4;

pub fn qr_text(code: &str) -> Option<String> {
    let qr = QrCode::new(format!("{QR_PREFIX}{code}")).ok()?;
    Some(
        qr.render::<unicode::Dense1x2>()
            .dark_color(unicode::Dense1x2::Light)
            .light_color(unicode::Dense1x2::Dark)
            .build(),
    )
}

/// 24-bit BMP of the QR code, black modules on white with the standard quiet zone.
pub fn qr_bmp(code: &str) -> Option<Vec<u8>> {
    let qr = QrCode::new(format!("{QR_PREFIX}{code}")).ok()?;
    let modules = qr.width();
    let colors = qr.to_colors();
    let side = (modules + 2 * QUIET_MODULES) * MODULE_PX;
    let row_bytes = (side * 3).div_ceil(4) * 4;
    let data_len = row_bytes * side;
    let mut bmp = Vec::with_capacity(54 + data_len);
    // File header + BITMAPINFOHEADER.
    bmp.extend_from_slice(b"BM");
    bmp.extend_from_slice(&((54 + data_len) as u32).to_le_bytes());
    bmp.extend_from_slice(&[0, 0, 0, 0]);
    bmp.extend_from_slice(&54u32.to_le_bytes());
    bmp.extend_from_slice(&40u32.to_le_bytes());
    bmp.extend_from_slice(&(side as i32).to_le_bytes());
    bmp.extend_from_slice(&(side as i32).to_le_bytes());
    bmp.extend_from_slice(&1u16.to_le_bytes());
    bmp.extend_from_slice(&24u16.to_le_bytes());
    bmp.extend_from_slice(&[0; 4]); // no compression
    bmp.extend_from_slice(&(data_len as u32).to_le_bytes());
    bmp.extend_from_slice(&[0; 16]); // resolution and palette: defaults
    // Pixel rows, bottom row first.
    for y in (0..side).rev() {
        let my = (y / MODULE_PX) as isize - QUIET_MODULES as isize;
        for x in 0..side {
            let mx = (x / MODULE_PX) as isize - QUIET_MODULES as isize;
            let dark = mx >= 0
                && my >= 0
                && (mx as usize) < modules
                && (my as usize) < modules
                && colors[my as usize * modules + mx as usize] == Color::Dark;
            let v = if dark { 0 } else { 255 };
            bmp.extend_from_slice(&[v, v, v]);
        }
        bmp.resize(bmp.len() + row_bytes - side * 3, 0);
    }
    Some(bmp)
}

/// "ABC123" → "ABC 123" (easier to read and type).
pub fn spaced(code: &str) -> String {
    if code.len() == 6 {
        format!("{} {}", &code[..3], &code[3..])
    } else {
        code.to_string()
    }
}

fn text(s: &str) -> Value {
    Value::String(s.to_string())
}

fn os_name() -> &'static str {
    if cfg!(windows) { "windows" } else { "linux" }
}

/// Where pairing progress is shown.
pub enum Ui {
    Terminal,
    /// Folder the installer window reads (`qr.bmp`, `status.txt`; `cancel` stops pairing).
    Files(PathBuf),
}

impl Ui {
    /// state: connecting | pending | paired | error. `left` = seconds until the code expires.
    fn status(&self, state: &str, code: &str, left: u64, message: &str) {
        match self {
            Ui::Terminal => {
                if !message.is_empty() {
                    println!("{message}");
                }
            }
            Ui::Files(dir) => {
                let body = format!(
                    "state={state}\ncode={}\nleft={left}\nmessage={message}\n",
                    spaced(code)
                );
                write_atomic(&dir.join("status.txt"), body.as_bytes());
            }
        }
    }

    fn show_code(&self, code: &str) {
        match self {
            Ui::Terminal => {
                println!();
                if let Some(qr) = qr_text(code) {
                    println!("{qr}");
                }
                println!("  Code: {}", spaced(code));
                println!();
                println!(
                    "  On your phone: open PC Monitor, tap \"Pair device\", and scan this QR code"
                );
                println!("  (or type the code). A new code appears if this one expires.");
                println!();
            }
            Ui::Files(dir) => {
                if let Some(bmp) = qr_bmp(code) {
                    write_atomic(&dir.join("qr.bmp"), &bmp);
                }
            }
        }
    }

    fn cancelled(&self) -> bool {
        matches!(self, Ui::Files(dir) if dir.join("cancel").exists())
    }
}

/// Write via a temporary file and rename, so the reader never sees a half-written file.
/// The reader may hold the file open for a moment, so retry briefly.
fn write_atomic(path: &Path, bytes: &[u8]) {
    let tmp = path.with_extension("tmp");
    if fs::write(&tmp, bytes).is_err() {
        return;
    }
    for _ in 0..10 {
        if fs::rename(&tmp, path).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

async fn connect(url: &str, ui: &Ui) -> ConvexClient {
    let mut delay = Duration::from_secs(2);
    loop {
        if ui.cancelled() {
            exit(3);
        }
        match tokio::time::timeout(Duration::from_secs(20), ConvexClient::new(url)).await {
            Ok(Ok(c)) => return c,
            _ => {
                ui.status(
                    "error",
                    "",
                    0,
                    "Cannot reach PC Monitor. Check the internet connection; retrying...",
                );
                tokio::time::sleep(delay).await;
                delay = (delay * 2).min(Duration::from_secs(30));
            }
        }
    }
}

/// Exit codes: 0 paired, 1 config problem, 3 cancelled.
pub async fn run(path: &Path, ui: Ui) {
    if let Ui::Files(dir) = &ui {
        let _ = fs::create_dir_all(dir);
        let _ = fs::remove_file(dir.join("cancel"));
        let _ = fs::remove_file(dir.join("qr.bmp"));
    }
    ui.status("connecting", "", 0, "Connecting to PC Monitor...");
    let mut config = match crate::config::Config::load(path) {
        Ok(c) => c,
        Err(e) => {
            ui.status("error", "", 0, &format!("{e} ({})", path.display()));
            exit(1);
        }
    };
    let secret = match config.ensure_device_secret(path) {
        Ok(s) => s,
        Err(e) => {
            ui.status("error", "", 0, &e.to_string());
            exit(1);
        }
    };
    let secret_hash = crate::config::secret_hash(&secret);
    let name = sysinfo::System::host_name().unwrap_or_else(|_| "unknown".to_string());
    let mut client = connect(&config.convex_url, &ui).await;

    let mut hello = BTreeMap::new();
    hello.insert("secretHash".to_string(), text(&secret_hash));
    // Already linked to an account: nothing to do. A device paired before accounts existed has
    // no owner, so it goes through pairing again to be claimed.
    if let Ok(FunctionResult::Value(Value::Object(o))) = client.mutation("agent:hello", hello).await
        && o.get("owned") == Some(&Value::Boolean(true))
    {
        ui.status("paired", "", 0, "This computer is already paired.");
        return;
    }

    // One code per round; an expired code starts a new round.
    loop {
        let mut args = BTreeMap::new();
        args.insert("secretHash".to_string(), text(&secret_hash));
        args.insert("name".to_string(), text(&name));
        args.insert("os".to_string(), text(os_name()));
        let code = match client.mutation("pairing:start", args).await {
            Ok(FunctionResult::Value(Value::Object(o))) => match o.get("code") {
                Some(Value::String(c)) => c.clone(),
                _ => String::new(),
            },
            _ => String::new(),
        };
        if code.is_empty() {
            ui.status("error", "", 0, "Could not get a pairing code; retrying...");
            tokio::time::sleep(Duration::from_secs(5)).await;
            continue;
        }
        let expires = Instant::now() + CODE_LIFETIME;
        ui.show_code(&code);

        let mut status_args = BTreeMap::new();
        status_args.insert("code".to_string(), text(&code));
        status_args.insert("secretHash".to_string(), text(&secret_hash));
        let mut sub = match client.subscribe("pairing:status", status_args).await {
            Ok(s) => s,
            Err(_) => {
                tokio::time::sleep(Duration::from_secs(5)).await;
                continue;
            }
        };
        let mut tick = tokio::time::interval(Duration::from_secs(1));
        let confirmed = loop {
            if ui.cancelled() {
                exit(3);
            }
            let left = expires.saturating_duration_since(Instant::now()).as_secs();
            if left == 0 {
                break false; // expired: next round gets a new code
            }
            tokio::select! {
                result = sub.next() => match result {
                    Some(FunctionResult::Value(Value::String(s))) if s == "confirmed" => break true,
                    Some(FunctionResult::Value(Value::String(s))) if s == "expired" || s == "unknown" => break false,
                    Some(_) => {}
                    None => break false,
                },
                _ = tick.tick() => ui.status("pending", &code, left, ""),
            }
        };
        if confirmed {
            ui.status(
                "paired",
                &code,
                0,
                "Paired. PC Monitor will now start monitoring this computer.",
            );
            if matches!(ui, Ui::Terminal) {
                tokio::time::sleep(Duration::from_secs(3)).await;
            }
            return;
        }
        ui.status(
            "connecting",
            "",
            0,
            "The code expired; getting a new one...",
        );
    }
}

/// `pc-monitor-agent unpair [config]`, run by the uninstaller: removes this device and its
/// history from PC Monitor. Always exits 0 so an offline computer can still be uninstalled.
pub async fn unpair(path: &Path) {
    let Ok(config) = crate::config::Config::load(path) else {
        println!("No config found; nothing to remove online.");
        return;
    };
    let Some(secret) = config.device_secret.as_deref() else {
        println!("This computer was never paired; nothing to remove online.");
        return;
    };
    let mut args = BTreeMap::new();
    args.insert(
        "secretHash".to_string(),
        text(&crate::config::secret_hash(secret)),
    );
    let removed = async {
        let mut client = ConvexClient::new(&config.convex_url).await.ok()?;
        client.mutation("agent:unpair", args).await.ok()
    };
    match tokio::time::timeout(Duration::from_secs(20), removed).await {
        Ok(Some(FunctionResult::Value(Value::Boolean(true)))) => {
            println!("Removed this computer from PC Monitor.")
        }
        Ok(Some(FunctionResult::Value(_))) => println!("This computer was already removed."),
        _ => println!("Could not reach PC Monitor; remove this computer from the dashboard later."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qr_contains_a_scannable_code() {
        let qr = qr_text("ABC234").unwrap();
        assert!(qr.lines().count() > 10, "a QR code is drawn");
        assert_eq!(spaced("ABC234"), "ABC 234");
    }

    #[test]
    fn qr_bmp_is_a_valid_square_bitmap() {
        let bmp = qr_bmp("ABC234").unwrap();
        assert_eq!(&bmp[0..2], b"BM");
        let width = i32::from_le_bytes(bmp[18..22].try_into().unwrap());
        let height = i32::from_le_bytes(bmp[22..26].try_into().unwrap());
        assert_eq!(width, height);
        assert_eq!(width as usize % MODULE_PX, 0);
        let declared = u32::from_le_bytes(bmp[2..6].try_into().unwrap()) as usize;
        assert_eq!(declared, bmp.len());
        // Top-left pixel is in the white quiet zone.
        let last_row = bmp.len() - (width as usize * 3).div_ceil(4) * 4;
        assert_eq!(&bmp[last_row..last_row + 3], &[255, 255, 255]);
    }
}
