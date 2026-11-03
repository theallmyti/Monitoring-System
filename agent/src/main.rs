//! S4 spike, now against the backend: push CPU and RAM every `live_interval_secs`.
//! Learning goal: async Rust, the Convex Rust client, device-secret auth.
//! Source: https://docs.convex.dev/client/rust and https://docs.rs/convex/0.10.4
//! (ConvexClient::new, ::mutation).

mod config;
mod dashboard;
mod gpu;

use std::collections::BTreeMap;
use std::path::Path;
use std::process::exit;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use convex::{ConvexClient, FunctionResult, Value};
use sysinfo::{Components, CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};

/// Hottest CPU sensor in Celsius. Raspberry Pi: cpu_thermal. Linux x86: coretemp/k10temp.
fn cpu_temp(components: &Components) -> Option<f64> {
    components
        .iter()
        .filter(|c| {
            let l = c.label().to_lowercase();
            l.contains("cpu") || l.contains("package") || l.contains("core")
        })
        .filter_map(|c| c.temperature())
        .fold(None, |max: Option<f64>, t| {
            Some(max.map_or(t as f64, |m| m.max(t as f64)))
        })
}

/// S2 spike: print every temperature sensor the OS exposes (Linux hwmon), then exit.
fn print_sensors() {
    let components = Components::new_with_refreshed_list().expect("failed to read sensors");
    for c in &components {
        match c.temperature() {
            Some(t) => println!("{:<40} {t:.1} °C", c.label()),
            None => println!("{:<40} n/a", c.label()),
        }
    }
}

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
    if std::env::args().nth(1).as_deref() == Some("sensors") {
        print_sensors();
        return;
    }
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
    let mut components = Components::new_with_refreshed_list().expect("failed to read sensors");
    // Container counts are fetched every 10 s (summary changes slowly).
    let mut docker: Option<dashboard::DockerSummary> = None;
    let mut tick: u64 = 0;
    println!("gpu={}", if nvml.is_some() { "nvidia" } else { "none" });

    // CPU usage needs two samples separated by a short delay.
    tokio::time::sleep(Duration::from_millis(500)).await;

    let mut ticker = tokio::time::interval(Duration::from_secs(config.live_interval_secs));
    loop {
        ticker.tick().await;
        sys.refresh_cpu_usage();
        sys.refresh_memory();
        components.refresh(false);
        tick += 1;
        if let Some(url) = config.dashboard_url.as_deref().filter(|_| tick % 10 == 1) {
            match dashboard::docker_summary(url) {
                Ok(d) => docker = Some(d),
                Err(e) => eprintln!("dashboard read failed: {e}"),
            }
        }

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
        if let Some(t) = cpu_temp(&components) {
            args.insert("cpuTemp".to_string(), Value::Float64(t));
        }
        if let Some(d) = docker {
            let mut o = BTreeMap::new();
            o.insert("running".to_string(), Value::Float64(f64::from(d.running)));
            o.insert("stopped".to_string(), Value::Float64(f64::from(d.stopped)));
            o.insert("errored".to_string(), Value::Float64(f64::from(d.error)));
            args.insert("docker".to_string(), Value::Object(o));
        }
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
