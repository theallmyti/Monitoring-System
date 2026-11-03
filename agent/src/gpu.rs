//! NVIDIA GPU stats via NVML (docs/Architecture.md §2.1, FR-22).
//! Source: nvml-wrapper 0.13.0 API (Nvml::init, Device::temperature, utilization_rates,
//! memory_info, power_usage, clock_info, fan_speed) and the NVML_* enum variants.

use nvml_wrapper::Nvml;
use nvml_wrapper::enum_wrappers::device::{Clock, TemperatureSensor};
use nvml_wrapper::error::NvmlError;

/// One reading. Units match docs/Database.md `latest.gpu`.
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

/// Start NVML. Fails on machines without an NVIDIA driver; the agent then runs without GPU stats.
pub fn init() -> Result<Nvml, NvmlError> {
    Nvml::init()
}

/// Read GPU 0.
pub fn read(nvml: &Nvml) -> Result<GpuStats, NvmlError> {
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
