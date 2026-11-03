//! Windows service mode (`pc-monitor-agent service`), started by the Service Control Manager.
//! The installer creates the service; SCM restarts it after a crash (NFR-06).
//! Config and log live in %ProgramData%\PCMonitor (docs/Security.md §6: owner-only ACL set by the installer).
//! API: windows-service 0.8 (define_windows_service!, service_dispatcher::start,
//! service_control_handler::register, set_service_status).

use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Notify;
use windows_service::service::{
    ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus, ServiceType,
};
use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
use windows_service::{define_windows_service, service_dispatcher};

pub const NAME: &str = "PCMonitorAgent";

define_windows_service!(ffi_service_main, service_main);

/// Hand control to the Service Control Manager. Only works when started as a service.
pub fn start() -> windows_service::Result<()> {
    service_dispatcher::start(NAME, ffi_service_main)
}

/// %ProgramData%\PCMonitor: config.toml and agent.log.
pub fn data_dir() -> PathBuf {
    std::env::var_os("ProgramData")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"))
        .join("PCMonitor")
}

fn status(state: ServiceState) -> ServiceStatus {
    ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: state,
        controls_accepted: if state == ServiceState::Running {
            ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN
        } else {
            ServiceControlAccept::empty()
        },
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: Duration::default(),
        process_id: None,
    }
}

fn service_main(_args: Vec<OsString>) {
    if let Err(e) = run() {
        crate::warn!("service error: {e}");
    }
}

fn run() -> windows_service::Result<()> {
    let stop = Arc::new(Notify::new());
    let on_stop = stop.clone();
    let handle = service_control_handler::register(NAME, move |control| match control {
        ServiceControl::Stop | ServiceControl::Shutdown => {
            on_stop.notify_one();
            ServiceControlHandlerResult::NoError
        }
        ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
        _ => ServiceControlHandlerResult::NotImplemented,
    })?;
    handle.set_service_status(status(ServiceState::Running))?;

    let dir = data_dir();
    let _ = std::fs::create_dir_all(&dir);
    let _ = crate::logging::to_file(&dir.join("agent.log"));
    crate::say!("service started (version {})", env!("CARGO_PKG_VERSION"));

    match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt.block_on(crate::run(dir.join("config.toml"), stop)),
        Err(e) => crate::warn!("cannot start runtime: {e}"),
    }

    crate::say!("service stopped");
    handle.set_service_status(status(ServiceState::Stopped))?;
    Ok(())
}
