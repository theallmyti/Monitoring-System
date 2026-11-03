//! CPU package temperature through the PawnIO driver ("full mode", F8, docs/Architecture.md §2.3).
//! Needs admin: the agent runs as a Windows service (LocalSystem) when this is enabled.
//!
//! PawnIOLib API (github.com/namazso/PawnIO, PawnIOLib.h): pawnio_open, pawnio_load,
//! pawnio_execute, pawnio_close. Signed modules (github.com/namazso/PawnIO.Modules, LGPL-2.1):
//! - AMDFamily17 (families 17h–1Ah): `ioctl_read_smn` (in: SMN address, out: value)
//! - IntelMSR: `ioctl_read_msr` (in: MSR, out: value)
//!
//! Without PawnIO (or on Linux) `CpuTemp::read` returns None and the agent stays in no-driver mode.

/// AMD Zen: THM_TCON_CUR_TMP register in SMN space.
pub const AMD_SMN_TEMP: u64 = 0x0005_9800;
/// Intel: IA32_TEMPERATURE_TARGET (TjMax) and IA32_PACKAGE_THERM_STATUS.
pub const INTEL_MSR_TEMP_TARGET: u64 = 0x1A2;
pub const INTEL_MSR_PACKAGE_THERM_STATUS: u64 = 0x1B1;

/// AMD: bits 31:21 hold the temperature in 1/8 °C; bit 19 selects the −49 °C range.
pub fn amd_temp(raw: u64) -> f64 {
    let mut t = ((raw >> 21) & 0x7FF) as f64 / 8.0;
    if raw & 0x8_0000 != 0 {
        t -= 49.0;
    }
    t
}

/// Intel: TjMax (target bits 23:16) minus the distance to TjMax (status bits 22:16).
pub fn intel_temp(target: u64, status: u64) -> f64 {
    let tjmax = ((target >> 16) & 0xFF) as f64;
    tjmax - ((status >> 16) & 0x7F) as f64
}

pub struct CpuTemp {
    #[cfg(windows)]
    inner: Option<imp::Reader>,
}

impl CpuTemp {
    /// Try to open PawnIO and load the module for this CPU. Never fails: without PawnIO,
    /// `available()` is false and the reason is logged.
    pub fn open() -> Self {
        #[cfg(windows)]
        {
            let inner = match imp::Reader::open() {
                Ok(r) => Some(r),
                Err(e) => {
                    crate::say!("cpu temperature: no-driver mode ({e})");
                    None
                }
            };
            Self { inner }
        }
        #[cfg(not(windows))]
        Self {}
    }

    pub fn available(&self) -> bool {
        #[cfg(windows)]
        return self.inner.is_some();
        #[cfg(not(windows))]
        false
    }

    pub fn read(&self) -> Option<f64> {
        #[cfg(windows)]
        return self.inner.as_ref().and_then(imp::Reader::read);
        #[cfg(not(windows))]
        None
    }
}

#[cfg(windows)]
mod imp {
    use std::ffi::{CString, c_char, c_void};
    use std::path::PathBuf;

    use libloading::Library;

    use super::*;

    type Handle = *mut c_void;
    type OpenFn = unsafe extern "system" fn(*mut Handle) -> i32;
    type LoadFn = unsafe extern "system" fn(Handle, *const u8, usize) -> i32;
    type ExecFn = unsafe extern "system" fn(
        Handle,
        *const c_char,
        *const u64,
        usize,
        *mut u64,
        usize,
        *mut usize,
    ) -> i32;
    type CloseFn = unsafe extern "system" fn(Handle) -> i32;

    enum Vendor {
        Amd,
        Intel { target: u64 },
    }

    pub struct Reader {
        _lib: Library, // keeps the function pointers below valid
        handle: Handle,
        exec: ExecFn,
        close: CloseFn,
        vendor: Vendor,
    }

    fn check(hr: i32, what: &str) -> Result<(), String> {
        if hr < 0 {
            Err(format!("{what} failed: 0x{:08X}", hr as u32))
        } else {
            Ok(())
        }
    }

    /// CPU vendor from CPUID leaf 0.
    fn is_amd() -> Result<bool, String> {
        #[cfg(target_arch = "x86_64")]
        {
            let r = std::arch::x86_64::__cpuid(0);
            let mut v = Vec::with_capacity(12);
            for reg in [r.ebx, r.edx, r.ecx] {
                v.extend_from_slice(&reg.to_le_bytes());
            }
            match v.as_slice() {
                b"AuthenticAMD" => Ok(true),
                b"GenuineIntel" => Ok(false),
                other => Err(format!(
                    "unsupported CPU vendor {}",
                    String::from_utf8_lossy(other)
                )),
            }
        }
        #[cfg(not(target_arch = "x86_64"))]
        Err("unsupported CPU architecture".to_string())
    }

    fn pawnio_lib() -> PathBuf {
        let installed = std::env::var_os("ProgramFiles")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Program Files"))
            .join("PawnIO")
            .join("PawnIOLib.dll");
        if installed.exists() {
            installed
        } else {
            PathBuf::from("PawnIOLib.dll")
        }
    }

    /// Modules ship next to the agent in a `pawnio` folder (installer).
    fn module_dir() -> PathBuf {
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("pawnio")))
            .unwrap_or_else(|| PathBuf::from("pawnio"))
    }

    impl Reader {
        pub fn open() -> Result<Self, String> {
            let amd = is_amd()?;
            // SAFETY: loading the official PawnIOLib; its exports match PawnIOLib.h.
            let lib = unsafe { Library::new(pawnio_lib()) }
                .map_err(|e| format!("PawnIO not installed ({e})"))?;
            let (open, load, exec, close) = unsafe {
                (
                    *lib.get::<OpenFn>(b"pawnio_open")
                        .map_err(|e| e.to_string())?,
                    *lib.get::<LoadFn>(b"pawnio_load")
                        .map_err(|e| e.to_string())?,
                    *lib.get::<ExecFn>(b"pawnio_execute")
                        .map_err(|e| e.to_string())?,
                    *lib.get::<CloseFn>(b"pawnio_close")
                        .map_err(|e| e.to_string())?,
                )
            };
            let mut handle: Handle = std::ptr::null_mut();
            check(unsafe { open(&mut handle) }, "pawnio_open (needs admin)")?;
            let mut reader = Reader {
                _lib: lib,
                handle,
                exec,
                close,
                vendor: Vendor::Amd,
            };
            let file = if amd {
                "AMDFamily17.bin"
            } else {
                "IntelMSR.bin"
            };
            let blob = std::fs::read(module_dir().join(file))
                .map_err(|e| format!("module {file} missing ({e})"))?;
            check(
                unsafe { load(reader.handle, blob.as_ptr(), blob.len()) },
                "pawnio_load",
            )?;
            if !amd {
                let target = reader.execute("ioctl_read_msr", INTEL_MSR_TEMP_TARGET)?;
                reader.vendor = Vendor::Intel { target };
            }
            reader
                .read()
                .ok_or_else(|| "first reading out of range".to_string())?;
            Ok(reader)
        }

        fn execute(&self, name: &str, arg: u64) -> Result<u64, String> {
            let fname = CString::new(name).map_err(|e| e.to_string())?;
            let input = [arg];
            let mut out = [0u64; 1];
            let mut written = 0usize;
            check(
                unsafe {
                    (self.exec)(
                        self.handle,
                        fname.as_ptr(),
                        input.as_ptr(),
                        1,
                        out.as_mut_ptr(),
                        1,
                        &mut written,
                    )
                },
                name,
            )?;
            if written < 1 {
                return Err(format!("{name} returned nothing"));
            }
            Ok(out[0])
        }

        pub fn read(&self) -> Option<f64> {
            let t = match self.vendor {
                Vendor::Amd => amd_temp(self.execute("ioctl_read_smn", AMD_SMN_TEMP).ok()?),
                Vendor::Intel { target } => intel_temp(
                    target,
                    self.execute("ioctl_read_msr", INTEL_MSR_PACKAGE_THERM_STATUS)
                        .ok()?,
                ),
            };
            // FR-28: impossible values are dropped.
            (0.0..=125.0).contains(&t).then_some(t)
        }
    }

    impl Drop for Reader {
        fn drop(&mut self) {
            unsafe {
                (self.close)(self.handle);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn amd_temperature_decoding() {
        // 60 °C = 480 eighths in bits 31:21.
        assert_eq!(amd_temp(480 << 21), 60.0);
        // Same raw value with the −49 °C range bit (19) set.
        assert_eq!(amd_temp((480 << 21) | 0x8_0000), 11.0);
        // Fractions: 60.125 °C.
        assert_eq!(amd_temp(481 << 21), 60.125);
    }

    #[test]
    fn intel_temperature_decoding() {
        // TjMax 100 °C, 40 °C below it → 60 °C.
        assert_eq!(intel_temp(100 << 16, 40 << 16), 60.0);
        // Other bits in the registers are ignored.
        assert_eq!(
            intel_temp((100 << 16) | 0xFF, (40 << 16) | 0x8000_0001),
            60.0
        );
    }
}
