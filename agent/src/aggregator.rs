//! 1 s samples → one summary per minute: averages and peaks (docs/Architecture.md §2.2).

/// One reading, taken every second.
#[derive(Debug, Clone, Copy, Default)]
pub struct Sample {
    pub cpu_util: f64,
    pub ram_pct: f64,
    pub cpu_temp: Option<f64>,
    pub gpu_temp: Option<f64>,
    pub gpu_util: Option<f64>,
    pub battery_pct: Option<f64>,
}

/// What `agent:pushSummary` stores (docs/Database.md summaries).
#[derive(Debug, PartialEq)]
pub struct Summary {
    pub cpu_util_avg: f64,
    pub cpu_util_max: f64,
    pub ram_pct_avg: f64,
    pub ram_pct_max: f64,
    pub cpu_temp_avg: Option<f64>,
    pub cpu_temp_max: Option<f64>,
    pub gpu_temp_max: Option<f64>,
    pub gpu_util_avg: Option<f64>,
    pub battery_pct: Option<f64>,
}

#[derive(Default)]
pub struct Aggregator {
    samples: Vec<Sample>,
}

impl Aggregator {
    pub fn push(&mut self, sample: Sample) {
        self.samples.push(sample);
    }

    /// Summarise everything since the last call and start a new minute. None if no samples.
    pub fn take(&mut self) -> Option<Summary> {
        let s = std::mem::take(&mut self.samples);
        if s.is_empty() {
            return None;
        }
        Some(Summary {
            cpu_util_avg: avg(s.iter().map(|x| x.cpu_util))?,
            cpu_util_max: max(s.iter().map(|x| x.cpu_util))?,
            ram_pct_avg: avg(s.iter().map(|x| x.ram_pct))?,
            ram_pct_max: max(s.iter().map(|x| x.ram_pct))?,
            // Optional readings use only the samples that had them.
            cpu_temp_avg: avg(s.iter().filter_map(|x| x.cpu_temp)),
            cpu_temp_max: max(s.iter().filter_map(|x| x.cpu_temp)),
            gpu_temp_max: max(s.iter().filter_map(|x| x.gpu_temp)),
            gpu_util_avg: avg(s.iter().filter_map(|x| x.gpu_util)),
            battery_pct: avg(s.iter().filter_map(|x| x.battery_pct)),
        })
    }
}

fn avg(values: impl Iterator<Item = f64>) -> Option<f64> {
    let (sum, n) = values.fold((0.0, 0u32), |(sum, n), v| (sum + v, n + 1));
    (n > 0).then(|| sum / f64::from(n))
}

fn max(values: impl Iterator<Item = f64>) -> Option<f64> {
    values.fold(None, |m: Option<f64>, v| Some(m.map_or(v, |m| m.max(v))))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(cpu: f64, ram: f64) -> Sample {
        Sample {
            cpu_util: cpu,
            ram_pct: ram,
            ..Sample::default()
        }
    }

    #[test]
    fn averages_and_peaks() {
        let mut a = Aggregator::default();
        a.push(sample(10.0, 40.0));
        a.push(sample(30.0, 60.0));
        a.push(sample(20.0, 50.0));
        let s = a.take().unwrap();
        assert_eq!(s.cpu_util_avg, 20.0);
        assert_eq!(s.cpu_util_max, 30.0);
        assert_eq!(s.ram_pct_avg, 50.0);
        assert_eq!(s.ram_pct_max, 60.0);
        assert_eq!(s.cpu_temp_avg, None);
        assert_eq!(s.gpu_temp_max, None);
    }

    #[test]
    fn optional_readings_use_only_samples_that_have_them() {
        let mut a = Aggregator::default();
        a.push(Sample {
            cpu_temp: Some(50.0),
            gpu_temp: Some(60.0),
            ..sample(5.0, 5.0)
        });
        a.push(sample(5.0, 5.0)); // sensor missed this second
        a.push(Sample {
            cpu_temp: Some(70.0),
            gpu_util: Some(40.0),
            ..sample(5.0, 5.0)
        });
        let s = a.take().unwrap();
        assert_eq!(s.cpu_temp_avg, Some(60.0));
        assert_eq!(s.cpu_temp_max, Some(70.0));
        assert_eq!(s.gpu_temp_max, Some(60.0));
        assert_eq!(s.gpu_util_avg, Some(40.0));
    }

    #[test]
    fn take_starts_a_new_minute() {
        let mut a = Aggregator::default();
        assert_eq!(a.take(), None);
        a.push(sample(10.0, 10.0));
        assert!(a.take().is_some());
        assert_eq!(a.take(), None);
    }
}
