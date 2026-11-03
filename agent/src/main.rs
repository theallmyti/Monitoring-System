//! S1 spike: print CPU util, RAM and temperature once per second.
//! Learning goal: basic Rust, sysinfo crate API.

mod config;
use std::thread::sleep;
use std::time::Duration;

use sysinfo::{Components, CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};

fn main() {
    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "config.toml".to_string());
    let config = match config::Config::load(std::path::Path::new(&path)) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("{e} (expected at {path}; copy config.example.toml)");
            std::process::exit(1);
        }
    };
    println!("Convex: {}", config.convex_url);
    let mut sys = System::new_with_specifics(
        RefreshKind::nothing()
            .with_cpu(CpuRefreshKind::everything())
            .with_memory(MemoryRefreshKind::everything()),
    )
    .expect("failed to read system info");
    let mut components = Components::new_with_refreshed_list().expect("failed to read sensors");

    // CPU usage needs two samples separated by a short delay.
    sleep(Duration::from_millis(500));

    loop {
        sys.refresh_cpu_usage();
        sys.refresh_memory();
        components.refresh(false);

        let cpu_total = sys.global_cpu_usage();
        let total_mem = sys.total_memory();
        let used_mem = sys.used_memory();
        let mem_pct = used_mem as f64 / total_mem as f64 * 100.0;

        // Pick the hottest sensor that looks like a CPU temperature.
        let cpu_temp = components
            .iter()
            .filter(|c| {
                let l = c.label().to_lowercase();
                l.contains("cpu") || l.contains("package") || l.contains("core")
            })
            .filter_map(|c| c.temperature())
            .fold(None, |max: Option<f32>, t| {
                Some(max.map_or(t, |m| m.max(t)))
            });

        let temp_text = match cpu_temp {
            Some(t) => format!("{t:.1} Ã‚Â°C"),
            None => "n/a (no driver or sensor)".to_string(),
        };

        println!(
            "CPU {cpu_total:5.1}% | RAM {:.1}/{:.1} GB ({mem_pct:4.1}%) | CPU temp {temp_text}",
            used_mem as f64 / 1_073_741_824.0,
            total_mem as f64 / 1_073_741_824.0,
        );

        sleep(Duration::from_secs(1));
    }
}
