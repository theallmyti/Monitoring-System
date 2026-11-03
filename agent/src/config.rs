//! Agent configuration, loaded from a TOML file (docs/Architecture.md §2.1).

use serde::Deserialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Deserialize, PartialEq)]
pub struct Config {
    pub convex_url: String,
    pub http_actions_url: String,
    pub summary_interval_secs: u64,
    pub live_interval_secs: u64,
}

#[derive(Debug)]
pub enum ConfigError {
    Read(std::io::Error),
    Parse(toml::de::Error),
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConfigError::Read(e) => write!(f, "cannot read config: {e}"),
            ConfigError::Parse(e) => write!(f, "invalid config: {e}"),
        }
    }
}

impl Config {
    /// Parse a config from TOML text.
    pub fn from_toml(text: &str) -> Result<Config, ConfigError> {
        toml::from_str(text).map_err(ConfigError::Parse)
    }

    /// Read and parse a config file from disk.
    pub fn load(path: &Path) -> Result<Config, ConfigError> {
        let text = fs::read_to_string(path).map_err(ConfigError::Read)?;
        Config::from_toml(&text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_example_config() {
        let text = include_str!("../config.example.toml");
        let cfg = Config::from_toml(text).expect("example config must parse");
        assert_eq!(cfg.convex_url, "https://different-alpaca-219.convex.cloud");
        assert_eq!(
            cfg.http_actions_url,
            "https://different-alpaca-219.convex.site"
        );
        assert_eq!(cfg.summary_interval_secs, 60);
        assert_eq!(cfg.live_interval_secs, 1);
    }

    #[test]
    fn rejects_missing_field() {
        assert!(Config::from_toml("convex_url = \"x\"").is_err());
    }
}
