//! `pc-monitor-agent pair [config]`: show a QR code and a 6-character code, wait until the owner
//! confirms it on the site or app, then exit (docs/Flow.md §3, FR-10). The installer runs this.
//! QR rendering: qrcode 0.14 (`render::<unicode::Dense1x2>()`, colours inverted for dark consoles).

use std::collections::BTreeMap;
use std::path::Path;
use std::process::exit;
use std::time::Duration;

use convex::{FunctionResult, Value};
use futures::StreamExt;
use qrcode::QrCode;
use qrcode::render::unicode;

/// What the QR code contains. The site and app scanners read the code after the prefix.
pub const QR_PREFIX: &str = "PCMONITOR-PAIR:";
/// FR-12: codes expire after 10 minutes; stop waiting a little after that.
const WAIT_LIMIT: Duration = Duration::from_secs(11 * 60);

pub fn qr_text(code: &str) -> Option<String> {
    let qr = QrCode::new(format!("{QR_PREFIX}{code}")).ok()?;
    Some(
        qr.render::<unicode::Dense1x2>()
            .dark_color(unicode::Dense1x2::Light)
            .light_color(unicode::Dense1x2::Dark)
            .build(),
    )
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

/// Exit codes: 0 paired, 1 config or connection problem, 2 code expired.
pub async fn run(path: &Path) {
    let mut config = match crate::config::Config::load(path) {
        Ok(c) => c,
        Err(e) => {
            println!("{e} ({})", path.display());
            exit(1);
        }
    };
    let secret = match config.ensure_device_secret(path) {
        Ok(s) => s,
        Err(e) => {
            println!("{e}");
            exit(1);
        }
    };
    let secret_hash = crate::config::secret_hash(&secret);
    let name = sysinfo::System::host_name().unwrap_or_else(|_| "unknown".to_string());

    println!("PC Monitor: pairing {name}");
    println!("Connecting...");
    let mut client = match tokio::time::timeout(
        Duration::from_secs(20),
        convex::ConvexClient::new(&config.convex_url),
    )
    .await
    {
        Ok(Ok(c)) => c,
        _ => {
            println!("Cannot reach PC Monitor. Check the internet connection and try again.");
            exit(1);
        }
    };

    let mut hello = BTreeMap::new();
    hello.insert("secretHash".to_string(), text(&secret_hash));
    if let Ok(FunctionResult::Value(_)) = client.mutation("agent:hello", hello).await {
        println!("This computer is already paired.");
        return;
    }

    let mut args = BTreeMap::new();
    args.insert("secretHash".to_string(), text(&secret_hash));
    args.insert("name".to_string(), text(&name));
    args.insert("os".to_string(), text(os_name()));
    let code = match client.mutation("pairing:start", args).await {
        Ok(FunctionResult::Value(Value::Object(o))) => match o.get("code") {
            Some(Value::String(c)) => c.clone(),
            _ => {
                println!("Unexpected answer from PC Monitor.");
                exit(1);
            }
        },
        other => {
            println!("Could not start pairing: {other:?}");
            exit(1);
        }
    };

    println!();
    if let Some(qr) = qr_text(&code) {
        println!("{qr}");
    }
    println!("  Code: {}", spaced(&code));
    println!();
    println!("  On your phone: open PC Monitor, tap \"Pair device\", and scan this QR code");
    println!("  (or type the code). It expires in 10 minutes.");
    println!();
    println!("Waiting for confirmation...");

    let mut status_args = BTreeMap::new();
    status_args.insert("code".to_string(), text(&code));
    status_args.insert("secretHash".to_string(), text(&secret_hash));
    let wait = async {
        let mut sub = client.subscribe("pairing:status", status_args).await.ok()?;
        while let Some(result) = sub.next().await {
            if let FunctionResult::Value(Value::String(state)) = result {
                match state.as_str() {
                    "confirmed" => return Some(true),
                    "expired" | "unknown" => return Some(false),
                    _ => {}
                }
            }
        }
        None
    };
    match tokio::time::timeout(WAIT_LIMIT, wait).await {
        Ok(Some(true)) => {
            println!("Paired. PC Monitor will now start monitoring this computer.");
            tokio::time::sleep(Duration::from_secs(3)).await;
        }
        _ => {
            println!("The code expired. Run pairing again to get a new code.");
            tokio::time::sleep(Duration::from_secs(5)).await;
            exit(2);
        }
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
        let mut client = convex::ConvexClient::new(&config.convex_url).await.ok()?;
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
}
