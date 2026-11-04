; PC Monitor agent installer (Inno Setup 6).
; Build: see installer/README.md. Output: dist\pc-monitor-agent-setup-<version>.exe
;
; Install (docs/Architecture.md §2.3a):
; - Asks for admin (UAC) like any installer; any local fixed drive works as the install folder
; - Locks the install folder to SYSTEM + Administrators (the service runs as LocalSystem)
; - Optional: installs the official PawnIO driver for CPU temperature (full mode, F8)
; - Writes %ProgramData%\PCMonitor\config.toml (SYSTEM + Administrators only, docs/Security.md §6)
; - "Pair this computer" page: QR code image, code, countdown; the owner scans it on the site/app
;   (docs/Flow.md §3). A new code appears automatically when one expires.
; - Creates the "PCMonitorAgent" Windows service (restarted after a crash, NFR-06) and starts it
;   once pairing is done or skipped
; Uninstall: stops and deletes the service, removes the device and its history from PC Monitor,
; removes PawnIO (silently if this installer added it, otherwise after asking), deletes all files.

#define AppName "PC Monitor Agent"
#define AppVersion "0.2.0"
#define ServiceName "PCMonitorAgent"
; The Convex URL is kept out of the repo: installer/convex-url.txt (git-ignored, one line).
#define UrlFile AddBackslash(SourcePath) + "convex-url.txt"
#if !FileExists(UrlFile)
  #error installer/convex-url.txt is missing. Put the Convex deployment URL in it (it is not committed).
#endif
#define UrlHandle FileOpen(UrlFile)
#define ConvexUrl Trim(FileRead(UrlHandle))
#expr FileClose(UrlHandle)
#if Pos(".convex.cloud", ConvexUrl) == 0
  #error installer/convex-url.txt must hold a Convex URL like https://<deployment>.convex.cloud
#endif
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
; Config (with the device secret), logs and pairing files.
Type: filesandordirs; Name: "{commonappdata}\PCMonitor"

[Code]
function DataDir(): String;
begin
  Result := ExpandConstant('{commonappdata}\PCMonitor');
end;

function PairDir(): String;
begin
  Result := DataDir() + '\pair';
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

// Created here, started after the pairing page so the agent starts as a paired device.
procedure CreateService();
begin
  if not ServiceExists() then
  begin
    Sc('create {#ServiceName} binPath= "\"' + ExpandConstant('{app}') + '\pc-monitor-agent.exe\" service" start= delayed-auto DisplayName= "{#AppName}"');
    Sc('description {#ServiceName} "Sends this computer''s hardware stats to PC Monitor."');
    // Restart after a crash: 5 s, 5 s, then 60 s; reset the count after a day (NFR-06).
    Sc('failure {#ServiceName} reset= 86400 actions= restart/5000/restart/5000/restart/60000');
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    LockDir(ExpandConstant('{app}'), True);
    WriteConfig();
    LockDir(DataDir(), False);
    InstallPawnIO();
    CreateService();
    // Silent installs skip the pairing page: start now; the agent waits until it is paired.
    if WizardSilent() then
      Sc('start {#ServiceName}');
  end;
end;

// --- Pairing page (installer/pairing-page.iss) ------------------------------------------------

#include "pairing-page.iss"

procedure InitializeWizard();
begin
  CreatePairingPage(wpInstalling);
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = PairPage.ID then
    StartPairing(ExpandConstant('{app}\pc-monitor-agent.exe'), PairDir(), DataDir() + '\config.toml');
end;

// Next (paired) or Skip: start the service either way; an unpaired agent waits until paired.
function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = PairPage.ID then
  begin
    Result := FinishPairingPage();
    if Result then
      Sc('start {#ServiceName}');
  end;
end;

procedure DeinitializeSetup();
begin
  StopPairing();
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
