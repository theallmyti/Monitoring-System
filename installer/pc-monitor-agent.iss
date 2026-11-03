; PC Monitor agent installer (Inno Setup 6).
; Build: see installer/README.md. Output: dist\pc-monitor-agent-setup-<version>.exe
;
; Install (docs/Architecture.md §2.3a):
; - Asks for admin (UAC) like any installer; any local fixed drive works as the install folder
; - Locks the install folder to SYSTEM + Administrators (the service runs as LocalSystem)
; - Optional: installs the official PawnIO driver for CPU temperature (full mode, F8)
; - Writes %ProgramData%\PCMonitor\config.toml (SYSTEM + Administrators only, docs/Security.md §6)
; - Pairing: opens a window with a QR code; the owner scans it on the site/app (docs/Flow.md §3)
; - Creates the "PCMonitorAgent" Windows service, restarted after a crash (NFR-06)
; Uninstall: stops and deletes the service, removes the device and its history from PC Monitor,
; removes PawnIO (silently if this installer added it, otherwise after asking), deletes all files.

#define AppName "PC Monitor Agent"
#define AppVersion "0.1.0"
#define ServiceName "PCMonitorAgent"
#define ConvexUrl "https://tidy-newt-65.convex.cloud"
#define StateKey "SOFTWARE\PC Monitor"

[Setup]
AppId={{F9FF55E1-801A-4E78-96FA-550A8B46C103}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Aditya Prasad, Tirth Patel
AppPublisherURL=https://github.com/theallmyti/Monitoring-System
DefaultDirName={autopf}\PC Monitor
DefaultGroupName=PC Monitor
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename=pc-monitor-agent-setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
LicenseFile=..\LICENSE
WizardStyle=modern
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\pc-monitor-agent.exe
SetupLogging=yes
CloseApplications=no

[Tasks]
Name: "cputemp"; Description: "Show CPU temperature (installs the PawnIO driver; the agent then runs with admin rights)"

[Files]
Source: "..\agent\target\release\pc-monitor-agent.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; DestName: "LICENSE.txt"
; Signed PawnIO modules (LGPL-2.1, github.com/namazso/PawnIO.Modules), fetched by fetch-pawnio.ps1
Source: "vendor\pawnio\AMDFamily17.bin"; DestDir: "{app}\pawnio"; Flags: ignoreversion
Source: "vendor\pawnio\IntelMSR.bin"; DestDir: "{app}\pawnio"; Flags: ignoreversion
Source: "vendor\pawnio\COPYING"; DestDir: "{app}\pawnio"; DestName: "COPYING-PawnIO-Modules.txt"
; Official signed PawnIO driver installer (github.com/namazso/PawnIO.Setup)
Source: "vendor\pawnio\PawnIO_setup.exe"; DestDir: "{tmp}"; Tasks: cputemp; Flags: deleteafterinstall

[Icons]
Name: "{group}\Uninstall PC Monitor Agent"; Filename: "{uninstallexe}"

[UninstallDelete]
; Config (with the device secret) and logs.
Type: filesandordirs; Name: "{commonappdata}\PCMonitor"

[Code]
function DataDir(): String;
begin
  Result := ExpandConstant('{commonappdata}\PCMonitor');
end;

function ConfigExists(): Boolean;
begin
  Result := FileExists(DataDir() + '\config.toml');
end;

function PawnIOInstalled(): Boolean;
begin
  Result := RegKeyExists(HKLM, 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\PawnIO');
end;

function ServiceExists(): Boolean;
var
  Code: Integer;
begin
  Result := Exec(ExpandConstant('{sys}\sc.exe'), 'query {#ServiceName}', '', SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0);
end;

procedure Sc(Params: String);
var
  Code: Integer;
begin
  Exec(ExpandConstant('{sys}\sc.exe'), Params, '', SW_HIDE, ewWaitUntilTerminated, Code);
  Log('sc.exe ' + Params + ' -> ' + IntToStr(Code));
end;

// Only SYSTEM and Administrators may change these folders: the agent runs as LocalSystem, so a
// user-writable folder (common outside Program Files, e.g. on E:) would let anyone replace it.
procedure LockDir(Dir: String; UsersCanRead: Boolean);
var
  Code: Integer;
  Grants: String;
begin
  Grants := '*S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F';
  if UsersCanRead then
    Grants := Grants + ' *S-1-5-32-545:(OI)(CI)RX';
  Exec(ExpandConstant('{sys}\icacls.exe'), '"' + Dir + '" /inheritance:r /grant:r ' + Grants,
    '', SW_HIDE, ewWaitUntilTerminated, Code);
  Log('icacls ' + Dir + ' -> ' + IntToStr(Code));
end;

// Stop a running agent before its files are replaced (upgrade).
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  if ServiceExists() then
    Sc('stop {#ServiceName}');
  Result := '';
end;

// The agent adds its device secret on first run. An upgrade keeps the existing file.
procedure WriteConfig();
begin
  ForceDirectories(DataDir());
  if not ConfigExists() then
    SaveStringToFile(DataDir() + '\config.toml',
      '# PC Monitor agent config, written by the installer.' + #13#10 +
      'convex_url = "{#ConvexUrl}"' + #13#10 +
      'live_interval_secs = 1' + #13#10, False);
end;

// Install PawnIO when asked and not already present; remember that we added it, so the
// uninstaller can remove it without affecting other apps that rely on PawnIO.
procedure InstallPawnIO();
var
  Code: Integer;
begin
  if not WizardIsTaskSelected('cputemp') or PawnIOInstalled() then
    Exit;
  WizardForm.StatusLabel.Caption := 'Installing the PawnIO driver...';
  Exec(ExpandConstant('{tmp}\PawnIO_setup.exe'), '-install -silent', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Log('PawnIO setup -> ' + IntToStr(Code));
  if PawnIOInstalled() then
    RegWriteDWordValue(HKLM, '{#StateKey}', 'InstalledPawnIO', 1);
end;

// Shows the QR code in a window and waits until the owner confirms it (exit 0), the code
// expires (2), or there is no connection (1). Already paired: returns at once.
procedure Pair();
var
  Code: Integer;
begin
  WizardForm.StatusLabel.Caption := 'Pairing: scan the QR code in the PC Monitor window...';
  Exec(ExpandConstant('{app}\pc-monitor-agent.exe'), 'pair "' + DataDir() + '\config.toml"',
    ExpandConstant('{app}'), SW_SHOWNORMAL, ewWaitUntilTerminated, Code);
  Log('pair -> ' + IntToStr(Code));
  if Code <> 0 then
    MsgBox('This computer is not paired yet. The agent is installed and will start sending data ' +
      'as soon as it is paired. To get a new code, run this setup again.', mbInformation, MB_OK);
end;

procedure InstallService();
begin
  if not ServiceExists() then
  begin
    Sc('create {#ServiceName} binPath= "\"' + ExpandConstant('{app}') + '\pc-monitor-agent.exe\" service" start= delayed-auto DisplayName= "{#AppName}"');
    Sc('description {#ServiceName} "Sends this computer''s hardware stats to PC Monitor."');
    // Restart after a crash: 5 s, 5 s, then 60 s; reset the count after a day (NFR-06).
    Sc('failure {#ServiceName} reset= 86400 actions= restart/5000/restart/5000/restart/60000');
  end;
  Sc('start {#ServiceName}');
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    LockDir(ExpandConstant('{app}'), True);
    WriteConfig();
    LockDir(DataDir(), False);
    InstallPawnIO();
    Pair();
    InstallService();
  end;
end;

// --- Uninstall -------------------------------------------------------------------------------

// Runs an uninstall command line from the registry, e.g. "C:\...\uninstall.exe" -uninstall -silent.
procedure RunCommandLine(CommandLine: String);
var
  Exe, Params: String;
  P, Code: Integer;
begin
  CommandLine := Trim(CommandLine);
  if Copy(CommandLine, 1, 1) = '"' then
  begin
    Delete(CommandLine, 1, 1);
    P := Pos('"', CommandLine);
    Exe := Copy(CommandLine, 1, P - 1);
    Params := Trim(Copy(CommandLine, P + 1, Length(CommandLine)));
  end
  else
  begin
    P := Pos(' ', CommandLine);
    if P = 0 then
    begin
      Exe := CommandLine;
      Params := '';
    end
    else
    begin
      Exe := Copy(CommandLine, 1, P - 1);
      Params := Trim(Copy(CommandLine, P + 1, Length(CommandLine)));
    end;
  end;
  Exec(Exe, Params, '', SW_HIDE, ewWaitUntilTerminated, Code);
  Log('ran ' + Exe + ' ' + Params + ' -> ' + IntToStr(Code));
end;

procedure RemovePawnIO();
var
  Added: Cardinal;
  Quiet: String;
begin
  if not PawnIOInstalled() then
    Exit;
  Added := 0;
  RegQueryDWordValue(HKLM, '{#StateKey}', 'InstalledPawnIO', Added);
  // Added by another app: ask first, it may still need the driver.
  if (Added <> 1) and (UninstallSilent() or
     (MsgBox('Also remove the PawnIO driver? Other apps (for example Fan Control or ' +
       'LibreHardwareMonitor) may use it.', mbConfirmation, MB_YESNO) <> IDYES)) then
    Exit;
  if RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\PawnIO',
       'QuietUninstallString', Quiet) then
    RunCommandLine(Quiet);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Code: Integer;
begin
  if CurUninstallStep = usUninstall then
  begin
    Sc('stop {#ServiceName}');
    // Remove this computer and its history from PC Monitor (needs the config, so before files go).
    Exec(ExpandConstant('{app}\pc-monitor-agent.exe'), 'unpair "' + DataDir() + '\config.toml"',
      '', SW_HIDE, ewWaitUntilTerminated, Code);
    Log('unpair -> ' + IntToStr(Code));
    Sc('delete {#ServiceName}');
    RemovePawnIO();
    RegDeleteKeyIncludingSubkeys(HKLM, '{#StateKey}');
  end;
end;
