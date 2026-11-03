//! Container counts from the home-server dashboard (`GET /api/system`, its `docker_summary`).
//! Used so the agent does not need the Docker socket, which is root-equivalent.

use serde::Deserialize;
use std::time::Duration;

#[derive(Debug, Deserialize, Clone, Copy)]
pub struct DockerSummary {
    pub running: u32,
    pub stopped: u32,
    /// The dashboard calls this `error`.
    pub error: u32,
}

#[derive(Deserialize)]
struct SystemSnapshot {
    docker_summary: DockerSummary,
}

/// Fetch the container counts. Short timeout: the caller is the live loop.
pub fn docker_summary(url: &str) -> Result<DockerSummary, String> {
    let mut resp = ureq::get(url)
        .config()
        .timeout_global(Some(Duration::from_secs(2)))
        .build()
        .call()
        .map_err(|e| e.to_string())?;
    let snap: SystemSnapshot = resp.body_mut().read_json().map_err(|e| e.to_string())?;
    Ok(snap.docker_summary)
}
