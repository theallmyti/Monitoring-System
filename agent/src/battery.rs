//! Laptop battery: charge %, charging, health %, cycles, power rate (FR-25).
//! Crate: starship-battery 0.12 (Manager::new, batteries, refresh, state_of_charge, state,
//! state_of_health, cycle_count, energy_rate; units from starship_battery::units).

use starship_battery::units::{power::watt, ratio::percent};
use starship_battery::{Battery, Manager, State};

pub struct BatteryStats {
    pub pct: f64,
    pub charging: bool,
    pub health_pct: f64,
    pub cycles: Option<u32>,
    pub rate_w: f64,
}

pub struct BatteryReader {
    manager: Manager,
    battery: Battery,
}

impl BatteryReader {
    /// None on machines without a battery (desktops, servers, the Pi).
    pub fn new() -> Option<Self> {
        let manager = Manager::new().ok()?;
        let battery = manager.batteries().ok()?.next()?.ok()?;
        Some(Self { manager, battery })
    }

    pub fn read(&mut self) -> Option<BatteryStats> {
        self.manager.refresh(&mut self.battery).ok()?;
        let b = &self.battery;
        Some(BatteryStats {
            pct: f64::from(b.state_of_charge().get::<percent>()).clamp(0.0, 100.0),
            charging: b.state() == State::Charging,
            // New batteries can report slightly above design capacity; show at most 100 %.
            health_pct: f64::from(b.state_of_health().get::<percent>()).clamp(0.0, 100.0),
            cycles: b.cycle_count(),
            rate_w: f64::from(b.energy_rate().get::<watt>()).abs(),
        })
    }
}
