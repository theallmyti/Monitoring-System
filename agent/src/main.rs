//! S4 spike, now against the backend: push CPU and RAM every `live_interval_secs`.
//! Learning goal: async Rust, the Convex Rust client, device-secret auth.
//! Source: https://docs.convex.dev/client/rust and https://docs.rs/convex/0.10.4
//! (ConvexClient::new, ::mutation).

mod config;
mod gpu;

use std::collections::BTreeMap;
use std::path::Path;
use std::process::exit;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use convex::{ConvexClient, FunctionResult, Value};
use sysinfo::{CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};

/// Convex `gpu` object (docs/Database.md `latest.gpu`). Optional fields are left out when absent.
fn gpu_value(g: &gpu::GpuStats) -> Value {
    let mut o = BTreeMap::new();
    o.insert("temp".to_string(), Value::Float64(f64::from(g.temp_c)));
    o.insert("util".to_string(), Value::Float64(f64::from(g.util_pct)));
    o.insert(
        "vramUsed".to_string(),
        Value::Float64(g.vram_used_mb as f64),
    );
    o.insert(
        "vramTotal".to_string(),
        Value::Float64(g.vram_total_mb as f64),
    );
    o.insert("powerW".to_string(), Value::Float64(g.power_w));
    o.insert("clock".to_string(), Value::Float64(f64::from(g.clock_mhz)));
    if let Some(fan) = g.fan_pct {
        o.insert("fanPct".to_string(), Value::Float64(f64::from(fan)));
    }
    Value::Object(o)
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "config.toml".to_string());
    let mut config = match config::Config::load(Path::new(&path)) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("{e} (expected at {path}; copy config.example.toml)");
            exit(1);
        }
    };
    let secret = match config.ensure_device_secret(Path::new(&path)) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("{e}");
            exit(1);
        }
    };
    let secret_hash = config::secret_hash(&secret);

    let device_name = System::host_name().unwrap_or_else(|_| "unknown".to_string());
    println!("device={device_name} convex={}", config.convex_url);

    let mut client = match ConvexClient::new(&config.convex_url).await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("cannot connect to Convex: {e}");
            exit(1);
        }
    };

    // Register (or refresh) this device. Pairing replaces this in week 2.
    let Some(registration_secret) = config.registration_secret.clone() else {
        eprintln!(
            "registration_secret missing from config.toml (get it from the other team member)"
        );
        exit(1);
    };
    let mut reg_args = BTreeMap::new();
    reg_args.insert(
        "registrationSecret".to_string(),
        Value::String(registration_secret),
    );
    reg_args.insert("secretHash".to_string(), Value::String(secret_hash.clone()));
    reg_args.insert("name".to_string(), Value::String(device_name.clone()));
    match client.mutation("agent:register", reg_args).await {
        Ok(FunctionResult::Value(_)) => println!("registered"),
        Ok(other) => {
            eprintln!("register failed: {other:?}");
            exit(1);
        }
        Err(e) => {
            eprintln!("register failed: {e}");
            exit(1);
        }
    }

    let mut sys = System::new_with_specifics(
        RefreshKind::nothing()
            .with_cpu(CpuRefreshKind::everything())
            .with_memory(MemoryRefreshKind::everything()),
    )
    .expect("failed to read system info");

    // No NVIDIA driver means no GPU stats; the rest of the agent keeps running (NFR-07).
    let nvml = gpu::init().ok();
    println!("gpu={}", if nvml.is_some() { "nvidia" } else { "none" });

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
        args.insert("secretHash".to_string(), Value::String(secret_hash.clone()));
        args.insert("ts".to_string(), Value::Float64(ts));
        args.insert("cpuUtil".to_string(), Value::Float64(cpu_util));
        args.insert("ramUsedPct".to_string(), Value::Float64(ram_pct));
        let gpu_text = match nvml.as_ref().map(gpu::read) {
            Some(Ok(g)) => {
                args.insert("gpu".to_string(), gpu_value(&g));
                format!(" gpu={}C {}%", g.temp_c, g.util_pct)
            }
            Some(Err(e)) => {
                eprintln!("gpu read failed: {e}");
                String::new()
            }
            None => String::new(),
        };

        match client.mutation("agent:pushLatest", args).await {
            Ok(FunctionResult::Value(_)) => {
                println!("pushed cpu={cpu_util:.1}% ram={ram_pct:.1}%{gpu_text}");
            }
            Ok(FunctionResult::ErrorMessage(msg)) => eprintln!("convex error: {msg}"),
            Ok(FunctionResult::ConvexError(err)) => eprintln!("convex error: {err:?}"),
            Err(e) => eprintln!("push failed: {e}"),
        }
    }
}
