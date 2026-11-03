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
- Uninstall: stops and deletes the service, removes the program and `C:\ProgramData\PCMonitor`.
  PawnIO stays installed (remove it from Settings → Apps if wanted).

## Build
1. `cd agent && cargo build --release`
2. `powershell -File installer\fetch-pawnio.ps1` (needs `gh`; downloads and checks the PawnIO files)
3. `"C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\pc-monitor-agent.iss`
   (or `%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe` for a per-user Inno Setup install)

## Known limits
- Not code-signed (no budget for a certificate), so Windows SmartScreen shows
  "Windows protected your PC". Click **More info → Run anyway**.
- The agent runs as LocalSystem even without the temperature option. A lower-privilege
  account for no-driver mode is a later improvement.
