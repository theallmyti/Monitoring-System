//! PC Monitor agent: samples every second, sends a summary every 60 s, and sends live
//! data only while someone is watching (docs/Architecture.md §2.2, FR-30, FR-31).
//! Convex client: https://docs.rs/convex/0.10.4 (clone shares the connection; the client
//! reconnects by itself with backoff, so only the first connection is retried here).

mod aggregator;
mod config;
mod dashboard;
mod gpu;

use std::collections::BTreeMap;
use std::path::Path;
use std::process::exit;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use aggregator::{Aggregator, Sample, Summary};
use convex::{ConvexClient, FunctionResult, Value};
use futures::StreamExt;
use sysinfo::{Components, CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};

/// FR-30: one summary per minute, always.
const SUMMARY_EVERY: Duration = Duration::from_secs(60);
/// A push that takes longer than this is dropped so sampling keeps going.
const PUSH_TIMEOUT: Duration = Duration::from_secs(5);

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

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn num(v: f64) -> Value {
    Value::Float64(v)
}

/// Convex `gpu` object (docs/Database.md `latest.gpu`). Optional fields are left out when absent.
fn gpu_value(g: &gpu::GpuStats) -> Value {
    let mut o = BTreeMap::new();
    o.insert("temp".to_string(), num(f64::from(g.temp_c)));
    o.insert("util".to_string(), num(f64::from(g.util_pct)));
    o.insert("vramUsed".to_string(), num(g.vram_used_mb as f64));
    o.insert("vramTotal".to_string(), num(g.vram_total_mb as f64));
    o.insert("powerW".to_string(), num(g.power_w));
    o.insert("clock".to_string(), num(f64::from(g.clock_mhz)));
    if let Some(fan) = g.fan_pct {
        o.insert("fanPct".to_string(), num(f64::from(fan)));
    }
    Value::Object(o)
}

/// Arguments for `agent:pushSummary`. Optional readings are left out when absent.
fn summary_args(secret_hash: &str, minute_ts: u64, s: &Summary) -> BTreeMap<String, Value> {
    let mut a = BTreeMap::new();
    a.insert(
        "secretHash".to_string(),
        Value::String(secret_hash.to_string()),
    );
    a.insert("minuteTs".to_string(), num(minute_ts as f64));
    a.insert("cpuUtilAvg".to_string(), num(s.cpu_util_avg));
    a.insert("cpuUtilMax".to_string(), num(s.cpu_util_max));
    a.insert("ramPctAvg".to_string(), num(s.ram_pct_avg));
    a.insert("ramPctMax".to_string(), num(s.ram_pct_max));
    let optional = [
        ("cpuTempAvg", s.cpu_temp_avg),
        ("cpuTempMax", s.cpu_temp_max),
        ("gpuTempMax", s.gpu_temp_max),
        ("gpuUtilAvg", s.gpu_util_avg),
    ];
    for (key, value) in optional {
        if let Some(v) = value {
            a.insert(key.to_string(), num(v));
        }
    }
    a
}

/// Run a mutation with a timeout; log failures. Returns true on success.
async fn push(client: &mut ConvexClient, name: &str, args: BTreeMap<String, Value>) -> bool {
    match tokio::time::timeout(PUSH_TIMEOUT, client.mutation(name, args)).await {
        Ok(Ok(FunctionResult::Value(_))) => true,
        Ok(Ok(FunctionResult::ErrorMessage(msg))) => {
            eprintln!("{name}: {msg}");
            false
        }
        Ok(Ok(FunctionResult::ConvexError(err))) => {
            eprintln!("{name}: {err:?}");
            false
        }
        Ok(Err(e)) => {
            eprintln!("{name} failed: {e}");
            false
        }
        Err(_) => {
            eprintln!(
                "{name}: no answer within {}s (offline?)",
                PUSH_TIMEOUT.as_secs()
            );
            false
        }
    }
}

/// First connection, retried with backoff 1 s → 60 s (docs/CHANGELOG.md decisions).
async fn connect(url: &str) -> ConvexClient {
    let mut delay = Duration::from_secs(1);
    loop {
        match ConvexClient::new(url).await {
            Ok(c) => return c,
            Err(e) => {
                eprintln!(
                    "cannot connect to Convex: {e}; retrying in {}s",
                    delay.as_secs()
                );
                tokio::time::sleep(delay).await;
                delay = (delay * 2).min(Duration::from_secs(60));
            }
        }
    }
}

/// Keep `viewer_until` in sync with the device's viewer flag (subscription to agent:watchViewer).
fn watch_viewer(mut client: ConvexClient, secret_hash: String, viewer_until: Arc<AtomicU64>) {
    tokio::spawn(async move {
        loop {
            let mut args = BTreeMap::new();
            args.insert("secretHash".to_string(), Value::String(secret_hash.clone()));
            match client.subscribe("agent:watchViewer", args).await {
                Ok(mut sub) => {
                    while let Some(result) = sub.next().await {
                        match result {
                            FunctionResult::Value(Value::Float64(t)) => {
                                viewer_until.store(t as u64, Ordering::Relaxed)
                            }
                            FunctionResult::Value(Value::Int64(t)) => {
                                viewer_until.store(t.max(0) as u64, Ordering::Relaxed)
                            }
                            other => eprintln!("agent:watchViewer: {other:?}"),
                        }
                    }
                }
                Err(e) => eprintln!("agent:watchViewer failed: {e}"),
            }
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });
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
    let mut client = connect(&config.convex_url).await;

    // Register (or refresh) this device. Pairing replaces this in Task 7.
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
    if !push(&mut client, "agent:register", reg_args).await {
        exit(1);
    }
    println!("registered");

    let viewer_until = Arc::new(AtomicU64::new(0));
    watch_viewer(client.clone(), secret_hash.clone(), viewer_until.clone());

    let mut sys = System::new_with_specifics(
        RefreshKind::nothing()
            .with_cpu(CpuRefreshKind::everything())
            .with_memory(MemoryRefreshKind::everything()),
    )
    .expect("failed to read system info");
    // No NVIDIA driver means no GPU stats; the rest of the agent keeps running (NFR-07).
    let nvml = gpu::init().ok();
    let mut components = Components::new_with_refreshed_list().expect("failed to read sensors");
    // Container counts are fetched every 10 s (they change slowly).
    let mut docker: Option<dashboard::DockerSummary> = None;
    println!("gpu={}", if nvml.is_some() { "nvidia" } else { "none" });

    // CPU usage needs two samples separated by a short delay.
    tokio::time::sleep(Duration::from_millis(500)).await;

    let mut aggregator = Aggregator::default();
    let mut next_summary = Instant::now() + SUMMARY_EVERY;
    let mut was_live = false;
    let mut tick: u64 = 0;
    let mut ticker = tokio::time::interval(Duration::from_secs(config.live_interval_secs));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        ticker.tick().await;
        tick += 1;
        sys.refresh_cpu_usage();
        sys.refresh_memory();
        components.refresh(false);
        if let Some(url) = config.dashboard_url.as_deref().filter(|_| tick % 10 == 1) {
            match dashboard::docker_summary(url) {
                Ok(d) => docker = Some(d),
                Err(e) => eprintln!("dashboard read failed: {e}"),
            }
        }

        let cpu_util = sys.global_cpu_usage() as f64;
        let ram_pct = sys.used_memory() as f64 / sys.total_memory() as f64 * 100.0;
        let cpu_t = cpu_temp(&components);
        let gpu = match nvml.as_ref().map(gpu::read) {
            Some(Ok(g)) => Some(g),
            Some(Err(e)) => {
                eprintln!("gpu read failed: {e}");
                None
            }
            None => None,
        };
        aggregator.push(Sample {
            cpu_util,
            ram_pct,
            cpu_temp: cpu_t,
            gpu_temp: gpu.as_ref().map(|g| f64::from(g.temp_c)),
            gpu_util: gpu.as_ref().map(|g| f64::from(g.util_pct)),
        });

        let now = now_ms();

        // Live: only while a viewer is present (FR-31).
        let live = viewer_until.load(Ordering::Relaxed) > now;
        if live != was_live {
            println!(
                "{}",
                if live {
                    "viewer present: live on"
                } else {
                    "no viewer: live off"
                }
            );
            was_live = live;
        }
        if live {
            let mut args = BTreeMap::new();
            args.insert("secretHash".to_string(), Value::String(secret_hash.clone()));
            args.insert("ts".to_string(), num(now as f64));
            args.insert("cpuUtil".to_string(), num(cpu_util));
            args.insert("ramUsedPct".to_string(), num(ram_pct));
            if let Some(t) = cpu_t {
                args.insert("cpuTemp".to_string(), num(t));
            }
            if let Some(d) = docker {
                let mut o = BTreeMap::new();
                o.insert("running".to_string(), num(f64::from(d.running)));
                o.insert("stopped".to_string(), num(f64::from(d.stopped)));
                o.insert("errored".to_string(), num(f64::from(d.error)));
                args.insert("docker".to_string(), Value::Object(o));
            }
            if let Some(g) = &gpu {
                args.insert("gpu".to_string(), gpu_value(g));
            }
            push(&mut client, "agent:pushLatest", args).await;
        }

        // Summary: every 60 s, always (FR-30).
        if Instant::now() >= next_summary {
            next_summary += SUMMARY_EVERY;
            if let Some(s) = aggregator.take() {
                let minute_ts = now / 60_000 * 60_000;
                if push(
                    &mut client,
                    "agent:pushSummary",
                    summary_args(&secret_hash, minute_ts, &s),
                )
                .await
                {
                    println!(
                        "summary cpu avg {:.1}% max {:.1}% ram avg {:.1}%",
                        s.cpu_util_avg, s.cpu_util_max, s.ram_pct_avg
                    );
                }
            }
        }
    }
}
