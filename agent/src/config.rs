//! Agent configuration, loaded from a TOML file (docs/Architecture.md §2.1).

use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

#[derive(Debug, Deserialize, PartialEq)]
pub struct Config {
    pub convex_url: String,
    pub live_interval_secs: u64,
    /// Home-server dashboard URL for container counts, e.g. http://localhost:8000/api/system (Pi only).
    #[serde(default)]
    pub dashboard_url: Option<String>,
    /// 256-bit device secret as hex. Generated on first run (docs/Security.md §6).
    #[serde(default)]
    pub device_secret: Option<String>,
    /// Team registration secret, needed once per PC to register (until pairing, week 2).
    /// Shared privately between the two of us, never in git (docs/Security.md §7).
    #[serde(default)]
    pub registration_secret: Option<String>,
}

#[derive(Debug)]
pub enum ConfigError {
    Read(std::io::Error),
    Write(std::io::Error),
    Parse(toml::de::Error),
    Random(getrandom::Error),
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConfigError::Read(e) => write!(f, "cannot read config: {e}"),
            ConfigError::Write(e) => write!(f, "cannot save device secret: {e}"),
            ConfigError::Parse(e) => write!(f, "invalid config: {e}"),
            ConfigError::Random(e) => write!(f, "cannot generate device secret: {e}"),
        }
    }
}

impl Config {
    /// Read and parse a config file from disk.
    pub fn load(path: &Path) -> Result<Config, ConfigError> {
        let text = fs::read_to_string(path).map_err(ConfigError::Read)?;
        toml::from_str(&text).map_err(ConfigError::Parse)
    }

    /// Return the device secret, generating and saving a new one if the config has none.
    /// TODO(week 2): restrict file permissions (docs/Security.md §6).
    pub fn ensure_device_secret(&mut self, path: &Path) -> Result<String, ConfigError> {
        if let Some(secret) = &self.device_secret {
            return Ok(secret.clone());
        }
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).map_err(ConfigError::Random)?;
        let secret = to_hex(&bytes);
        let mut file = OpenOptions::new()
            .append(true)
            .open(path)
            .map_err(ConfigError::Write)?;
        writeln!(
            file,
            "\n# Generated on first run. Keep private.\ndevice_secret = \"{secret}\""
        )
        .map_err(ConfigError::Write)?;
        self.device_secret = Some(secret.clone());
        Ok(secret)
    }
}

/// SHA-256 of the device secret, hex. This is what the agent sends to Convex.
pub fn secret_hash(secret: &str) -> String {
    to_hex(&Sha256::digest(secret.as_bytes()))
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_example_config() {
        let cfg: Config = toml::from_str(include_str!("../config.example.toml"))
            .expect("example config must parse");
        assert_eq!(cfg.convex_url, "https://YOUR-DEPLOYMENT.convex.cloud");
        assert_eq!(cfg.live_interval_secs, 1);
        assert_eq!(cfg.device_secret, None);
    }

    #[test]
    fn rejects_missing_field() {
        assert!(toml::from_str::<Config>("convex_url = \"x\"").is_err());
    }

    #[test]
    fn secret_hash_is_sha256_hex() {
        // SHA-256("abc") from FIPS 180-2 test vectors.
        assert_eq!(
            secret_hash("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn generates_secret_once_and_keeps_it() {
        let path = std::env::temp_dir().join(format!("pcm-test-{}.toml", std::process::id()));
        fs::write(&path, "convex_url = \"x\"\nlive_interval_secs = 1\n").unwrap();

        let mut cfg = Config::load(&path).unwrap();
        let first = cfg.ensure_device_secret(&path).unwrap();
        assert_eq!(first.len(), 64, "256-bit secret as 64 hex chars");

        // Second run reads the saved secret back instead of making a new one.
        let mut again = Config::load(&path).unwrap();
        assert_eq!(again.ensure_device_secret(&path).unwrap(), first);

        fs::remove_file(&path).unwrap();
    }
}
