//! Fixed hardware facts, read once at start and sent with the capabilities (`agent:hello`).
//!
//! Memory speed comes from the SMBIOS table (Windows: `GetSystemFirmwareTable('RSMB')`,
//! no admin needed). SMBIOS 3.x, type 17 "Memory Device":
//! - 0x0C Size (WORD): 0 = empty slot
//! - 0x15 Speed (WORD, MT/s): 0 = unknown, 0xFFFF = see Extended Speed at 0x54 (DWORD)
//! - 0x20 Configured Memory Speed (WORD, MT/s, SMBIOS 2.7+): 0xFFFF = see 0x58 (DWORD)
//!
//! Configured speed is what the RAM actually runs at (it can be below the rated speed).
//! Linux needs root for the SMBIOS table, so the Pi does not report it.
#![cfg_attr(not(windows), allow(dead_code))]

const RAW_HEADER: usize = 8; // RawSMBIOSData: 4 version bytes + table length (DWORD)
const TYPE_MEMORY_DEVICE: u8 = 17;
const TYPE_END: u8 = 127;

fn word(b: &[u8], at: usize) -> Option<u32> {
    b.get(at..at + 2)
        .map(|w| u32::from(u16::from_le_bytes([w[0], w[1]])))
}

fn dword(b: &[u8], at: usize) -> Option<u32> {
    b.get(at..at + 4)
        .map(|w| u32::from_le_bytes([w[0], w[1], w[2], w[3]]))
}

/// A speed field with its extended DWORD fallback; None when unknown.
fn speed(s: &[u8], at: usize, extended_at: usize) -> Option<u32> {
    match word(s, at)? {
        0 => None,
        0xFFFF => dword(s, extended_at).filter(|&v| v > 0),
        v => Some(v),
    }
}

/// Highest memory speed (MT/s) of the installed modules in an SMBIOS structure table.
pub fn ram_speed_from_smbios(table: &[u8]) -> Option<u32> {
    let mut best: Option<u32> = None;
    let mut i = 0;
    while i + 4 <= table.len() {
        let kind = table[i];
        let len = usize::from(table[i + 1]);
        if len < 4 || i + len > table.len() {
            break;
        }
        let s = &table[i..i + len];
        if kind == TYPE_MEMORY_DEVICE && word(s, 0x0C).is_some_and(|size| size != 0) {
            let found = speed(s, 0x20, 0x58).or_else(|| speed(s, 0x15, 0x54));
            if let Some(v) = found {
                best = Some(best.map_or(v, |b| b.max(v)));
            }
        }
        if kind == TYPE_END {
            break;
        }
        // Skip the strings after the formatted area: they end with two zero bytes.
        let mut j = i + len;
        while j + 1 < table.len() && !(table[j] == 0 && table[j + 1] == 0) {
            j += 1;
        }
        i = j + 2;
    }
    best
}

#[cfg(windows)]
pub fn ram_speed_mts() -> Option<u32> {
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetSystemFirmwareTable(provider: u32, id: u32, buf: *mut u8, size: u32) -> u32;
    }
    let rsmb = u32::from_be_bytes(*b"RSMB");
    // SAFETY: a null buffer with size 0 only returns the needed size; the second call writes
    // at most `size` bytes into a buffer of exactly that length.
    let size = unsafe { GetSystemFirmwareTable(rsmb, 0, std::ptr::null_mut(), 0) };
    if size as usize <= RAW_HEADER {
        return None;
    }
    let mut buf = vec![0u8; size as usize];
    let got = unsafe { GetSystemFirmwareTable(rsmb, 0, buf.as_mut_ptr(), size) };
    if got == 0 || got > size {
        return None;
    }
    ram_speed_from_smbios(buf.get(RAW_HEADER..got as usize)?)
}

#[cfg(not(windows))]
pub fn ram_speed_mts() -> Option<u32> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A type 17 structure (0x5C bytes) with the given size and speeds, plus one string.
    fn memory_device(size_mb: u16, speed: u16, configured: u16, extended: u32) -> Vec<u8> {
        let mut s = vec![0u8; 0x5C];
        s[0] = TYPE_MEMORY_DEVICE;
        s[1] = 0x5C;
        s[0x0C..0x0E].copy_from_slice(&size_mb.to_le_bytes());
        s[0x15..0x17].copy_from_slice(&speed.to_le_bytes());
        s[0x20..0x22].copy_from_slice(&configured.to_le_bytes());
        s[0x58..0x5C].copy_from_slice(&extended.to_le_bytes());
        s.extend_from_slice(b"DIMM 0\0\0");
        s
    }

    fn end() -> Vec<u8> {
        vec![TYPE_END, 4, 0, 0, 0, 0]
    }

    #[test]
    fn uses_configured_speed_of_installed_modules() {
        let mut t = memory_device(8192, 3200, 2933, 0);
        t.extend(memory_device(0, 4800, 4800, 0)); // empty slot: ignored
        t.extend(memory_device(8192, 3200, 3200, 0));
        t.extend(end());
        assert_eq!(ram_speed_from_smbios(&t), Some(3200));
    }

    #[test]
    fn falls_back_to_rated_and_extended_speeds() {
        let mut rated = memory_device(16384, 2666, 0, 0);
        rated.extend(end());
        assert_eq!(ram_speed_from_smbios(&rated), Some(2666));

        let mut extended = memory_device(16384, 0xFFFF, 0xFFFF, 70_000);
        extended.extend(end());
        assert_eq!(ram_speed_from_smbios(&extended), Some(70_000));
    }

    #[test]
    fn unknown_or_broken_tables_give_none() {
        assert_eq!(ram_speed_from_smbios(&[]), None);
        assert_eq!(ram_speed_from_smbios(&[17, 200, 0, 0]), None); // length past the end
        let mut unknown = memory_device(8192, 0, 0, 0);
        unknown.extend(end());
        assert_eq!(ram_speed_from_smbios(&unknown), None);
    }
}
