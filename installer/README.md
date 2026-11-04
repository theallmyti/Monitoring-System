# Windows installer

Builds `dist\pc-monitor-agent-setup-<version>.exe`, a normal Windows setup program.

## What it does
- Asks for admin (UAC), installs to `C:\Program Files\PC Monitor`.
- Writes `C:\ProgramData\PCMonitor\config.toml`, readable only by SYSTEM and Administrators.
- **Pairing:** opens a window with a QR code and a 6-character code. Open the site on your
  phone, tap **Pair device**, scan the code (or type it), and confirm. The window closes and
  setup continues. If the code expires, the agent is still installed and starts sending data
  once paired; run the setup again to get a new code.
- Optional, on by default: **Show CPU temperature**. Installs the official signed PawnIO
  driver (`PawnIO_setup.exe -install -silent`) and the signed AMD/Intel modules. Without it the
  agent runs in no-driver mode (no CPU temperature).
- Creates the `PCMonitorAgent` Windows service (LocalSystem, delayed auto-start), restarted
  5 s / 5 s / 60 s after a crash, and starts it. Log: `C:\ProgramData\PCMonitor\agent.log`.
- Upgrade: keeps the config, stops the service, replaces files, starts it again.

## Install location
Any local fixed drive works (for example `E:\PC Monitor`). The folder only holds the program;
config and logs always live in `C:\ProgramData\PCMonitor`. The drive must be present when Windows
starts (not a USB or network drive), because the service starts at boot. Setup locks the folder
to SYSTEM and Administrators, since the agent runs as LocalSystem.

## Uninstall
Three ways, all doing the same: Start menu → PC Monitor → Uninstall PC Monitor Agent,
Settings → Apps, or `dist\pc-monitor-agent-uninstall.exe` (works for any installed version).
- Stops and deletes the service.
- Removes this computer and its history from the PC Monitor dashboard (`pc-monitor-agent unpair`).
- Removes the PawnIO driver: without asking if this setup installed it, otherwise after asking,
  because other apps (Fan Control, LibreHardwareMonitor) may use it.
- Deletes the program folder and `C:\ProgramData\PCMonitor`.

## Build
1. `cd agent && cargo build --release`
2. Put the Convex deployment URL in `installer\convex-url.txt` (one line, git-ignored; ask the
   project owner). The build stops if it is missing or not a Convex URL.
3. `powershell -File installer\fetch-pawnio.ps1` (needs `gh`; downloads and checks the PawnIO files)
4. `"C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\pc-monitor-agent.iss`
   (or `%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe` for a per-user Inno Setup install)
5. Same for `installer\pc-monitor-agent-uninstall.iss` → `dist\pc-monitor-agent-uninstall.exe`

## Known limits
- Not code-signed (no budget for a certificate), so Windows SmartScreen shows
  "Windows protected your PC". Click **More info → Run anyway**.
- The agent runs as LocalSystem even without the temperature option. A lower-privilege
  account for no-driver mode is a later improvement.
