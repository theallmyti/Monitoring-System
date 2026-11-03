//! PC Monitor agent: samples every second, sends a summary every 60 s, and sends live
//! data only while someone is watching (docs/Architecture.md §2.2, FR-30, FR-31).
//! Convex client: https://docs.rs/convex/0.10.4 (clone shares the connection; the client
//! reconnects by itself with backoff, so only the first connection is retried here).

#[macro_use]
mod logging;
mod aggregator;
mod battery;
mod collectors;
mod config;
mod cputemp;
mod dashboard;
mod gpu;
mod pair;
#[cfg(windows)]
mod service;

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::exit;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use aggregator::{Aggregator, Sample, Summary};
use collectors::{Drive, Proc};
use convex::{ConvexClient, FunctionResult, Value};
use futures::StreamExt;
use sysinfo::{Components, CpuRefreshKind, Disks, MemoryRefreshKind, RefreshKind, System};
use tokio::sync::Notify;

/// FR-30: one summary per minute, always.
const SUMMARY_EVERY: Duration = Duration::from_secs(60);
/// A push that takes longer than this is dropped so sampling keeps going.
const PUSH_TIMEOUT: Duration = Duration::from_secs(5);
/// Live view refresh intervals for the slower readings, in seconds (ticks).
const PROCESS_EVERY: u64 = 5;
const DRIVES_EVERY: u64 = 10;
const DOCKER_EVERY: u64 = 10;
const BATTERY_EVERY: u64 = 10;

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
            Some(t) => say!("{:<40} {t:.1} °C", c.label()),
            None => say!("{:<40} n/a", c.label()),
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

fn text(s: &str) -> Value {
    Value::String(s.to_string())
}

fn obj<const N: usize>(fields: [(&str, Value); N]) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect(),
    )
}

fn numbers(values: &[f64]) -> Value {
    Value::Array(values.iter().map(|v| num(*v)).collect())
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

fn drives_live(drives: &[Drive]) -> Value {
    Value::Array(
        drives
            .iter()
            .map(|d| {
                obj([
                    ("name", text(&d.name)),
                    ("totalGB", num(d.total_gb)),
                    ("freeGB", num(d.free_gb)),
                ])
            })
            .collect(),
    )
}

fn drives_summary(drives: &[Drive]) -> Value {
    Value::Array(
        drives
            .iter()
            .map(|d| {
                let pct = if d.total_gb > 0.0 {
                    d.free_gb / d.total_gb * 100.0
                } else {
                    0.0
                };
                obj([
                    ("name", text(&d.name)),
                    ("freeGB", num(d.free_gb)),
                    ("freePct", num(pct)),
                ])
            })
            .collect(),
    )
}

fn procs_value(procs: &[Proc]) -> Value {
    Value::Array(
        procs
            .iter()
            .map(|p| obj([("name", text(&p.name)), ("mb", num(p.mb))]))
            .collect(),
    )
}

/// FR-15: what this device can report (docs/Database.md §2).
fn capabilities_value(
    has_gpu: bool,
    has_battery: bool,
    full_mode: bool,
    components: &Components,
    drives: &[Drive],
) -> Value {
    let mut o = BTreeMap::new();
    o.insert("hasBattery".to_string(), Value::Boolean(has_battery));
    o.insert("hasNvidiaGpu".to_string(), Value::Boolean(has_gpu));
    o.insert(
        "perCoreTemps".to_string(),
        Value::Boolean(collectors::has_per_core_temps(components)),
    );
    if cfg!(windows) {
        let mode = if full_mode { "full" } else { "noDriver" };
        o.insert("windowsMode".to_string(), text(mode));
    }
    o.insert(
        "isPi".to_string(),
        Value::Boolean(collectors::is_raspberry_pi()),
    );
    o.insert(
        "drives".to_string(),
        Value::Array(
            drives
                .iter()
                .map(|d| obj([("name", text(&d.name)), ("totalGB", num(d.total_gb))]))
                .collect(),
        ),
    );
    Value::Object(o)
}

/// Arguments for `agent:pushSummary`. Optional readings are left out when absent.
fn summary_args(
    secret_hash: &str,
    minute_ts: u64,
    s: &Summary,
    drives: &[Drive],
) -> BTreeMap<String, Value> {
    let mut a = BTreeMap::new();
    a.insert("secretHash".to_string(), text(secret_hash));
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
        ("batteryPct", s.battery_pct),
    ];
    for (key, value) in optional {
        if let Some(v) = value {
            a.insert(key.to_string(), num(v));
        }
    }
    if !drives.is_empty() {
        a.insert("disks".to_string(), drives_summary(drives));
    }
    a
}

/// Run a mutation with a timeout; log failures. Returns true on success.
async fn push(client: &mut ConvexClient, name: &str, args: BTreeMap<String, Value>) -> bool {
    match tokio::time::timeout(PUSH_TIMEOUT, client.mutation(name, args)).await {
        Ok(Ok(FunctionResult::Value(_))) => true,
        Ok(Ok(FunctionResult::ErrorMessage(msg))) => {
            warn!("{name}: {msg}");
            false
        }
        Ok(Ok(FunctionResult::ConvexError(err))) => {
            warn!("{name}: {err:?}");
            false
        }
        Ok(Err(e)) => {
            warn!("{name} failed: {e}");
            false
        }
        Err(_) => {
            warn!(
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
                warn!(
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
            args.insert("secretHash".to_string(), text(&secret_hash));
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
                            other => warn!("agent:watchViewer: {other:?}"),
                        }
                    }
                }
                Err(e) => warn!("agent:watchViewer failed: {e}"),
            }
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });
}

fn main() {
    let first = std::env::args().nth(1);
    match first.as_deref() {
        // Helper mode: read the GPU in a separate process (see gpu.rs).
        Some("gpu") => {
            let every_ms = std::env::args().nth(2).and_then(|v| v.parse().ok());
            exit(gpu::run_helper(every_ms));
        }
        Some("sensors") => {
            print_sensors();
            return;
        }
        // Show a QR code and wait for the owner to confirm (run by the installer).
        Some("pair") => {
            let path = PathBuf::from(
                std::env::args()
                    .nth(2)
                    .unwrap_or_else(|| "config.toml".to_string()),
            );
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("failed to start the async runtime")
                .block_on(pair::run(&path));
            return;
        }
        // Started by the Windows Service Control Manager (installed by the setup program).
        #[cfg(windows)]
        Some("service") => {
            if let Err(e) = service::start() {
                warn!("run as a service only: {e}");
                exit(1);
            }
            return;
        }
        _ => {}
    }
    let path = PathBuf::from(first.unwrap_or_else(|| "config.toml".to_string()));
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("failed to start the async runtime");
    // Runs until the process is stopped; the service passes a real stop signal instead.
    runtime.block_on(run(path, Arc::new(Notify::new())));
}

/// The agent: load config, register, then sample / summary / live loop until `stop` fires.
pub async fn run(path: PathBuf, stop: Arc<Notify>) {
    let mut config = match config::Config::load(&path) {
        Ok(c) => c,
        Err(e) => {
            warn!(
                "{e} (expected at {}; copy config.example.toml)",
                path.display()
            );
            exit(1);
        }
    };
    let secret = match config.ensure_device_secret(&path) {
        Ok(s) => s,
        Err(e) => {
            warn!("{e}");
            exit(1);
        }
    };
    let secret_hash = config::secret_hash(&secret);

    // Readers first, so registration can report capabilities.
    let mut sys = System::new_with_specifics(
        RefreshKind::nothing()
            .with_cpu(CpuRefreshKind::everything())
            .with_memory(MemoryRefreshKind::everything()),
    )
    .expect("failed to read system info");
    // No NVIDIA driver means no GPU stats; the rest of the agent keeps running (NFR-07).
    let mut gpu_reader = gpu::GpuReader::new().await;
    // Windows no-driver mode has no temperature sensors, and listing them goes through WMI,
    // which loads heavy system libraries. Keep an empty list there (Task 16, NFR-01).
    // Windows full mode: CPU temperature through PawnIO (admin). Logs why when unavailable.
    let cpu_temp_reader = cputemp::CpuTemp::open();
    let mut components = if cfg!(windows) {
        Components::new().expect("failed to create sensor list")
    } else {
        Components::new_with_refreshed_list().expect("failed to read sensors")
    };
    let mut disks = Disks::new_with_refreshed_list().ok();
    let mut drives = disks.as_ref().map(collectors::drives).unwrap_or_default();
    // None on machines without a battery; then no battery data is sent.
    let mut battery_reader = battery::BatteryReader::new();
    let mut battery_now: Option<battery::BatteryStats> = None;

    let device_name = System::host_name().unwrap_or_else(|_| "unknown".to_string());
    say!(
        "device={device_name} convex={} gpu={} drives={}",
        config.convex_url,
        if gpu_reader.present() {
            "nvidia"
        } else {
            "none"
        },
        drives.len()
    );
    let mut client = connect(&config.convex_url).await;

    // Say hello: the device must be paired (docs/Flow.md §3). Until then, retry every minute,
    // so a service started before pairing picks it up without a restart.
    let mut hello_args = BTreeMap::new();
    hello_args.insert("secretHash".to_string(), text(&secret_hash));
    hello_args.insert(
        "capabilities".to_string(),
        capabilities_value(
            gpu_reader.present(),
            battery_reader.is_some(),
            cpu_temp_reader.available(),
            &components,
            &drives,
        ),
    );
    hello_args.insert("agentVersion".to_string(), text(env!("CARGO_PKG_VERSION")));
    while !push(&mut client, "agent:hello", hello_args.clone()).await {
        say!("not paired yet: run `pc-monitor-agent pair`; retrying in 60 s");
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(60)) => {}
            _ = stop.notified() => return,
        }
    }
    say!("connected as a paired device");

    let viewer_until = Arc::new(AtomicU64::new(0));
    watch_viewer(client.clone(), secret_hash.clone(), viewer_until.clone());

    // Container counts are fetched every 10 s (they change slowly).
    let mut docker: Option<dashboard::DockerSummary> = None;
    let mut top: Vec<Proc> = Vec::new();

    // CPU usage needs two samples separated by a short delay.
    tokio::time::sleep(Duration::from_millis(500)).await;

    let mut aggregator = Aggregator::default();
    let mut next_summary = Instant::now() + SUMMARY_EVERY;
    let mut was_live = false;
    let mut tick: u64 = 0;
    let mut ticker = tokio::time::interval(Duration::from_secs(config.live_interval_secs));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            _ = ticker.tick() => {}
            _ = stop.notified() => {
                say!("stopping");
                return;
            }
        }
        tick += 1;
        sys.refresh_cpu_usage();
        sys.refresh_memory();
        if !cfg!(windows) {
            components.refresh(false);
        }
        if let Some(url) = config
            .dashboard_url
            .as_deref()
            .filter(|_| tick % DOCKER_EVERY == 1)
        {
            match dashboard::docker_summary(url) {
                Ok(d) => docker = Some(d),
                Err(e) => warn!("dashboard read failed: {e}"),
            }
        }

        // Battery changes slowly: read it every 10 s.
        if tick % BATTERY_EVERY == 1
            && let Some(r) = battery_reader.as_mut()
        {
            battery_now = r.read();
        }

        let now = now_ms();
        // Live: only while a viewer is present (FR-31).
        let live = viewer_until.load(Ordering::Relaxed) > now;

        let cpu_util = sys.global_cpu_usage() as f64;
        let ram_pct = sys.used_memory() as f64 / sys.total_memory() as f64 * 100.0;
        // Full mode (PawnIO, admin) first; otherwise the OS sensors (Linux hwmon).
        let cpu_t = cpu_temp_reader.read().or_else(|| cpu_temp(&components));
        // GPU: every second while live; every 30 s otherwise, without keeping NVML loaded.
        let gpu = gpu_reader.read(live).await;
        aggregator.push(Sample {
            cpu_util,
            ram_pct,
            cpu_temp: cpu_t,
            gpu_temp: gpu.as_ref().map(|g| f64::from(g.temp_c)),
            gpu_util: gpu.as_ref().map(|g| f64::from(g.util_pct)),
            battery_pct: battery_now.as_ref().map(|b| b.pct),
        });

        let summary_due = Instant::now() >= next_summary;

        if live != was_live {
            say!(
                "{}",
                if live {
                    "viewer present: live on"
                } else {
                    "no viewer: live off"
                }
            );
            was_live = live;
        }

        // Drives: every 10 s while live, and before each summary.
        if ((live && tick % DRIVES_EVERY == 1) || summary_due)
            && let Some(d) = disks.as_mut()
        {
            d.refresh(true);
            drives = collectors::drives(d);
        }

        if live {
            // Processes only while someone is watching, every 5 s (keeps idle CPU low).
            if top.is_empty() || tick % PROCESS_EVERY == 1 {
                collectors::refresh_processes(&mut sys);
                top = collectors::top_processes(&sys, 5);
            }
            let (per_core, clocks) = collectors::per_core(&sys);
            let ram = collectors::ram_detail(&sys);

            let mut args = BTreeMap::new();
            args.insert("secretHash".to_string(), text(&secret_hash));
            args.insert("ts".to_string(), num(now as f64));
            args.insert("cpuUtil".to_string(), num(cpu_util));
            args.insert("ramUsedPct".to_string(), num(ram_pct));
            args.insert("perCoreUtil".to_string(), numbers(&per_core));
            args.insert("clocks".to_string(), numbers(&clocks));
            args.insert(
                "ram".to_string(),
                obj([
                    ("used", num(ram.used)),
                    ("free", num(ram.free)),
                    ("total", num(ram.total)),
                    ("swapUsed", num(ram.swap_used)),
                    ("swapTotal", num(ram.swap_total)),
                ]),
            );
            args.insert("topProcs".to_string(), procs_value(&top));
            if !drives.is_empty() {
                args.insert("disks".to_string(), drives_live(&drives));
            }
            if let Some(up) = collectors::uptime_secs() {
                args.insert("uptimeSec".to_string(), num(up as f64));
            }
            if let Some(t) = cpu_t {
                args.insert("cpuTemp".to_string(), num(t));
            }
            if let Some(d) = docker {
                args.insert(
                    "docker".to_string(),
                    obj([
                        ("running", num(f64::from(d.running))),
                        ("stopped", num(f64::from(d.stopped))),
                        ("errored", num(f64::from(d.error))),
                    ]),
                );
            }
            if let Some(g) = &gpu {
                args.insert("gpu".to_string(), gpu_value(g));
            }
            if let Some(b) = &battery_now {
                let mut o = BTreeMap::new();
                o.insert("pct".to_string(), num(b.pct));
                o.insert("charging".to_string(), Value::Boolean(b.charging));
                o.insert("healthPct".to_string(), num(b.health_pct));
                o.insert("rateW".to_string(), num(b.rate_w));
                if let Some(c) = b.cycles {
                    o.insert("cycles".to_string(), num(f64::from(c)));
                }
                args.insert("battery".to_string(), Value::Object(o));
            }
            push(&mut client, "agent:pushLatest", args).await;
        } else if !top.is_empty() {
            // Free the process list when nobody is watching.
            top.clear();
        }

        // Summary: every 60 s, always (FR-30).
        if summary_due {
            next_summary += SUMMARY_EVERY;
            if let Some(s) = aggregator.take() {
                let minute_ts = now / 60_000 * 60_000;
                if push(
                    &mut client,
                    "agent:pushSummary",
                    summary_args(&secret_hash, minute_ts, &s, &drives),
                )
                .await
                {
                    say!(
                        "summary cpu avg {:.1}% max {:.1}% ram avg {:.1}%",
                        s.cpu_util_avg,
                        s.cpu_util_max,
                        s.ram_pct_avg
                    );
                }
            }
        }
    }
}
