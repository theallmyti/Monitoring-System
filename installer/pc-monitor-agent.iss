; PC Monitor agent installer (Inno Setup 6).
; Build: see installer/README.md. Output: dist\pc-monitor-agent-setup-<version>.exe
;
; What it does (docs/Architecture.md §2.3a):
; - Asks for admin (UAC) like any installer, installs to Program Files
; - Optional: installs the official PawnIO driver for CPU temperature (full mode, F8)
; - Writes %ProgramData%\PCMonitor\config.toml (SYSTEM + Administrators only, docs/Security.md §6)
; - Pairing: opens a window with a QR code; the owner scans it on the site/app (docs/Flow.md §3)
; - Creates the "PCMonitorAgent" Windows service, restarted after a crash (NFR-06)

#define AppName "PC Monitor Agent"
#define AppVersion "0.1.0"
#define ServiceName "PCMonitorAgent"
#define ConvexUrl "https://tidy-newt-65.convex.cloud"

[Setup]
AppId={{F9FF55E1-801A-4E78-96FA-550A8B46C103}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Aditya Prasad, Tirth Patel
AppPublisherURL=https://github.com/theallmyti/Monitoring-System
DefaultDirName={autopf}\PC Monitor
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

[Run]
Filename: "{tmp}\PawnIO_setup.exe"; Parameters: "-install -silent"; StatusMsg: "Installing the PawnIO driver..."; Tasks: cputemp; Check: not PawnIOInstalled; Flags: waituntilterminated

[UninstallRun]
Filename: "{sys}\sc.exe"; Parameters: "stop {#ServiceName}"; Flags: runhidden waituntilterminated; RunOnceId: "StopService"
Filename: "{sys}\sc.exe"; Parameters: "delete {#ServiceName}"; Flags: runhidden waituntilterminated; RunOnceId: "DeleteService"

[UninstallDelete]
; Config (with the device secret) and logs. PawnIO stays installed; remove it from Apps if wanted.
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

// SYSTEM and Administrators only (docs/Security.md §6): the file holds the device secret.
procedure LockDataDir();
var
  Code: Integer;
begin
  Exec(ExpandConstant('{sys}\icacls.exe'),
    '"' + DataDir() + '" /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F',
    '', SW_HIDE, ewWaitUntilTerminated, Code);
  Log('icacls -> ' + IntToStr(Code));
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
    WriteConfig();
    LockDataDir();
    Pair();
    InstallService();
  end;
end;
