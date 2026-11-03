//! S4 spike: push CPU and RAM to Convex every `live_interval_secs`.
//! Learning goal: async Rust, the Convex Rust client, measuring agent RAM.
//! Source: https://docs.convex.dev/client/rust and https://docs.rs/convex/0.10.4 (ConvexClient::new, ::mutation).

mod config;

use std::collections::BTreeMap;
use std::path::Path;
use std::process::exit;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use convex::{ConvexClient, FunctionResult, Value};
use sysinfo::{CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "config.toml".to_string());
    let config = match config::Config::load(Path::new(&path)) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("{e} (expected at {path}; copy config.example.toml)");
            exit(1);
        }
    };

    let device_name = System::host_name().unwrap_or_else(|_| "unknown".to_string());
    println!("device={device_name} convex={}", config.convex_url);

    let mut client = match ConvexClient::new(&config.convex_url).await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("cannot connect to Convex: {e}");
            exit(1);
        }
    };

    let mut sys = System::new_with_specifics(
        RefreshKind::nothing()
            .with_cpu(CpuRefreshKind::everything())
            .with_memory(MemoryRefreshKind::everything()),
    )
    .expect("failed to read system info");

    // CPU usage needs two samples separated by a short delay.
    tokio::time::sleep(Duration::from_millis(500)).await;

    let mut ticker = tokio::time::interval(Duration::from_secs(config.live_interval_secs));
    loop {
        ticker.tick().await;
        sys.refresh_cpu_usage();
        sys.refresh_memory();

        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as f64)
            .unwrap_or(0.0);
        let cpu_util = sys.global_cpu_usage() as f64;
        let ram_pct = sys.used_memory() as f64 / sys.total_memory() as f64 * 100.0;

        let mut args = BTreeMap::new();
        args.insert("deviceName".to_string(), Value::String(device_name.clone()));
        args.insert("ts".to_string(), Value::Float64(ts));
        args.insert("cpuUtil".to_string(), Value::Float64(cpu_util));
        args.insert("ramUsedPct".to_string(), Value::Float64(ram_pct));

        match client.mutation("spike:pushLatest", args).await {
            Ok(FunctionResult::Value(_)) => {
                println!("pushed cpu={cpu_util:.1}% ram={ram_pct:.1}%");
            }
            Ok(FunctionResult::ErrorMessage(msg)) => eprintln!("convex error: {msg}"),
            Ok(FunctionResult::ConvexError(err)) => eprintln!("convex error: {err:?}"),
            Err(e) => eprintln!("push failed: {e}"),
        }
    }
}
