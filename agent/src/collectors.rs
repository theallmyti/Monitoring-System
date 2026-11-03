//! Readings beyond CPU total and RAM %: per-core CPU, RAM detail, top processes, drives,
//! uptime and capabilities (FR-15, FR-20, FR-23, FR-24, FR-26). All from sysinfo 0.40.

use std::collections::{HashMap, HashSet};

use sysinfo::{Components, Disks, ProcessRefreshKind, ProcessesToUpdate, System};

const GB: f64 = 1_073_741_824.0;
const MB: f64 = 1_048_576.0;

/// Per-core use (%) and clock (MHz), one entry per logical core.
pub fn per_core(sys: &System) -> (Vec<f64>, Vec<f64>) {
    sys.cpus()
        .iter()
        .map(|c| (f64::from(c.usage()).clamp(0.0, 100.0), c.frequency() as f64))
        .unzip()
}

/// RAM and swap in GB. "free" is memory available to programs.
pub struct RamDetail {
    pub used: f64,
    pub free: f64,
    pub total: f64,
    pub swap_used: f64,
    pub swap_total: f64,
}

pub fn ram_detail(sys: &System) -> RamDetail {
    RamDetail {
        used: sys.used_memory() as f64 / GB,
        free: sys.available_memory() as f64 / GB,
        total: sys.total_memory() as f64 / GB,
        swap_used: sys.used_swap() as f64 / GB,
        swap_total: sys.total_swap() as f64 / GB,
    }
}

pub struct Proc {
    pub name: String,
    pub mb: f64,
}

/// Refresh process memory only (no CPU, disk or command line) to keep the agent light.
pub fn refresh_processes(sys: &mut System) {
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_memory(),
    );
}

pub fn top_processes(sys: &System, n: usize) -> Vec<Proc> {
    top_by_name(
        sys.processes()
            .values()
            .map(|p| (p.name().to_string_lossy().into_owned(), p.memory())),
        n,
    )
}

/// Group processes with the same name (a browser runs many) and keep the `n` largest.
pub fn top_by_name(procs: impl Iterator<Item = (String, u64)>, n: usize) -> Vec<Proc> {
    let mut by_name: HashMap<String, u64> = HashMap::new();
    for (name, bytes) in procs {
        *by_name.entry(name).or_default() += bytes;
    }
    let mut sorted: Vec<(String, u64)> = by_name.into_iter().collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    sorted
        .into_iter()
        .take(n)
        .map(|(name, bytes)| Proc {
            name,
            mb: bytes as f64 / MB,
        })
        .collect()
}

pub struct Drive {
    pub name: String,
    pub total_gb: f64,
    pub free_gb: f64,
}

pub fn drives(disks: &Disks) -> Vec<Drive> {
    fixed_drives(disks.iter().map(|d| {
        (
            d.mount_point().to_string_lossy().into_owned(),
            d.is_removable(),
            d.total_space(),
            d.available_space(),
        )
    }))
}

/// Keep fixed drives that have a size, one per mount point. Windows "C:\" becomes "C:".
pub fn fixed_drives(items: impl Iterator<Item = (String, bool, u64, u64)>) -> Vec<Drive> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for (mount, removable, total, available) in items {
        if removable || total == 0 {
            continue;
        }
        let trimmed = mount.trim_end_matches(['\\', '/']);
        let name = if trimmed.is_empty() {
            "/".to_string()
        } else {
            trimmed.to_string()
        };
        if seen.insert(name.clone()) {
            out.push(Drive {
                name,
                total_gb: total as f64 / GB,
                free_gb: (available.min(total)) as f64 / GB,
            });
        }
    }
    out
}

pub fn uptime_secs() -> Option<u64> {
    System::uptime().ok()
}

/// True when the OS exposes per-core temperature sensors (Linux coretemp, not Windows no-driver).
pub fn has_per_core_temps(components: &Components) -> bool {
    components
        .iter()
        .any(|c| c.label().to_lowercase().contains("core") && c.temperature().is_some())
}

/// Raspberry Pi detection via the device tree (also readable inside the Pi container's /sys mount).
pub fn is_raspberry_pi() -> bool {
    [
        "/sys/firmware/devicetree/base/model",
        "/proc/device-tree/model",
    ]
    .iter()
    .filter_map(|p| std::fs::read_to_string(p).ok())
    .any(|model| model.contains("Raspberry Pi"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn top_processes_are_grouped_by_name_and_sorted() {
        let procs = vec![
            ("chrome.exe".to_string(), 300 * 1_048_576),
            ("code.exe".to_string(), 500 * 1_048_576),
            ("chrome.exe".to_string(), 400 * 1_048_576),
            ("idle".to_string(), 1_048_576),
        ];
        let top = top_by_name(procs.into_iter(), 2);
        assert_eq!(top.len(), 2);
        assert_eq!(top[0].name, "chrome.exe");
        assert_eq!(top[0].mb, 700.0);
        assert_eq!(top[1].name, "code.exe");
    }

    #[test]
    fn drives_skip_removable_and_empty_and_dedupe_mounts() {
        let gb = 1_073_741_824u64;
        let items = vec![
            ("C:\\".to_string(), false, 500 * gb, 100 * gb),
            ("E:\\".to_string(), true, 64 * gb, 10 * gb),
            ("D:\\".to_string(), false, 0, 0),
            ("/".to_string(), false, 30 * gb, 20 * gb),
            ("C:\\".to_string(), false, 500 * gb, 100 * gb),
        ];
        let d = fixed_drives(items.into_iter());
        let names: Vec<&str> = d.iter().map(|x| x.name.as_str()).collect();
        assert_eq!(names, vec!["C:", "/"]);
        assert_eq!(d[0].total_gb, 500.0);
        assert_eq!(d[0].free_gb, 100.0);
    }
}
