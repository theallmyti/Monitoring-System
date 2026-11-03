//! NVIDIA GPU stats via NVML (docs/Architecture.md §2.1, FR-22).
//! Source: nvml-wrapper 0.13.0 API (Nvml::init, Device::temperature, utilization_rates,
//! memory_info, power_usage, clock_info, fan_speed) and the NVML_* enum variants.
//!
//! NVIDIA's library adds ~17 MB and cannot be unloaded from a process on Windows (measured,
//! Task 16). So the agent never loads it itself: it runs a copy of itself as a GPU helper.
//! - Live (someone watching): a helper streams one reading per second; stopped when live ends.
//! - Idle: a one-shot helper takes one reading every `IDLE_EVERY`.

use std::io::Write;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use nvml_wrapper::Nvml;
use nvml_wrapper::enum_wrappers::device::{Clock, TemperatureSensor};
use nvml_wrapper::error::NvmlError;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

/// While nobody is watching, read the GPU this often.
pub const IDLE_EVERY: Duration = Duration::from_secs(30);
/// A one-shot helper that takes longer than this is abandoned.
const HELPER_TIMEOUT: Duration = Duration::from_secs(5);

/// One reading. Units match docs/Database.md `latest.gpu`.
#[derive(Clone, Serialize, Deserialize)]
pub struct GpuStats {
    pub temp_c: u32,
    pub util_pct: u32,
    pub vram_used_mb: u64,
    pub vram_total_mb: u64,
    pub power_w: f64,
    pub clock_mhz: u32,
    /// Laptop GPUs often report no fan speed.
    pub fan_pct: Option<u32>,
}

/// Read GPU 0.
fn read(nvml: &Nvml) -> Result<GpuStats, NvmlError> {
    let device = nvml.device_by_index(0)?;
    let mem = device.memory_info()?;
    Ok(GpuStats {
        temp_c: device.temperature(TemperatureSensor::Gpu)?,
        util_pct: device.utilization_rates()?.gpu,
        vram_used_mb: mem.used / 1_048_576,
        vram_total_mb: mem.total / 1_048_576,
        power_w: f64::from(device.power_usage()?) / 1000.0,
        clock_mhz: device.clock_info(Clock::Graphics)?,
        fan_pct: device.fan_speed(0).ok(),
    })
}

/// Helper mode (`pc-monitor-agent gpu [every_ms]`): print readings as JSON lines.
/// Without `every_ms` it prints one reading and exits. Exit code 1: no NVIDIA GPU.
pub fn run_helper(every_ms: Option<u64>) -> i32 {
    let Ok(nvml) = Nvml::init() else {
        return 1;
    };
    let mut out = std::io::stdout().lock();
    loop {
        if let Ok(stats) = read(&nvml)
            && let Ok(line) = serde_json::to_string(&stats)
            && (writeln!(out, "{line}").is_err() || out.flush().is_err())
        {
            return 0; // parent went away
        }
        match every_ms {
            Some(ms) => std::thread::sleep(Duration::from_millis(ms)),
            None => return 0,
        }
    }
}

fn helper_command(exe: &PathBuf) -> Command {
    let mut cmd = Command::new(exe);
    cmd.arg("gpu")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console window flashing
    cmd
}

struct Stream {
    child: Child,
    latest: Arc<Mutex<Option<GpuStats>>>,
}

pub struct GpuReader {
    exe: Option<PathBuf>,
    stream: Option<Stream>,
    last_idle_read: Option<Instant>,
}

impl GpuReader {
    /// Probe once with a one-shot helper. No NVIDIA GPU → the agent runs without GPU stats.
    pub async fn new() -> Self {
        let exe = std::env::current_exe().ok();
        let mut reader = Self {
            exe,
            stream: None,
            last_idle_read: None,
        };
        if reader.one_shot().await.is_none() {
            reader.exe = None;
        }
        reader
    }

    pub fn present(&self) -> bool {
        self.exe.is_some()
    }

    async fn one_shot(&self) -> Option<GpuStats> {
        let exe = self.exe.as_ref()?;
        let output = tokio::time::timeout(HELPER_TIMEOUT, helper_command(exe).output())
            .await
            .ok()?
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8(output.stdout).ok()?;
        serde_json::from_str(text.lines().next()?).ok()
    }

    fn start_stream(&mut self) {
        let Some(exe) = &self.exe else { return };
        let mut cmd = helper_command(exe);
        cmd.arg("1000");
        let Ok(mut child) = cmd.spawn() else {
            eprintln!("gpu helper failed to start");
            return;
        };
        let latest = Arc::new(Mutex::new(None));
        if let Some(stdout) = child.stdout.take() {
            let slot = latest.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if let Ok(stats) = serde_json::from_str::<GpuStats>(&line)
                        && let Ok(mut s) = slot.lock()
                    {
                        *s = Some(stats);
                    }
                }
            });
        }
        self.stream = Some(Stream { child, latest });
    }

    /// Live: newest reading from the streaming helper (started on first use).
    /// Idle: stops the stream; one reading at most every `IDLE_EVERY`, otherwise None.
    pub async fn read(&mut self, live: bool) -> Option<GpuStats> {
        if !self.present() {
            return None;
        }
        if live {
            if self.stream.is_none() {
                self.start_stream();
            }
            let stream = self.stream.as_ref()?;
            return stream.latest.lock().ok()?.clone();
        }
        if let Some(mut s) = self.stream.take() {
            let _ = s.child.start_kill(); // nobody watching: stop the helper
        }
        let due = self
            .last_idle_read
            .is_none_or(|t| t.elapsed() >= IDLE_EVERY);
        if !due {
            return None;
        }
        self.last_idle_read = Some(Instant::now());
        self.one_shot().await
    }
}
