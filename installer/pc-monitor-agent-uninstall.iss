; Standalone uninstaller: dist\pc-monitor-agent-uninstall.exe (Inno Setup 6).
; Removes PC Monitor Agent from any installed version:
; 1. removes this computer and its history from PC Monitor (bundled agent: `unpair`)
; 2. runs the installed uninstaller silently and waits until it has finished
; 3. removes the PawnIO driver if it is still present, after asking (other apps may use it)

#define AppId "{F9FF55E1-801A-4E78-96FA-550A8B46C103}"

[Setup]
AppName=PC Monitor Agent Uninstaller
AppVersion=0.1.0
CreateAppDir=no
Uninstallable=no
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename=pc-monitor-agent-uninstall
WizardStyle=modern

[Files]
Source: "..\agent\target\release\pc-monitor-agent.exe"; Flags: dontcopy

[Code]
const
  UninstKey = 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{#AppId}_is1';
  PawnIOKey = 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\PawnIO';

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
    Exe := CommandLine;
    Params := '';
  end;
  Exec(Exe, Params, '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

// The Inno uninstaller relaunches itself from a temp copy, so waiting on the process returns
// early. Wait until its registry entry is gone instead (up to 2 minutes).
procedure WaitForUninstall();
var
  I: Integer;
begin
  for I := 1 to 240 do
  begin
    if not RegKeyExists(HKLM, UninstKey) then
      Exit;
    Sleep(500);
  end;
end;

function InitializeSetup(): Boolean;
var
  Uninstaller, Quiet: String;
  Code: Integer;
  Installed: Boolean;
begin
  Result := False; // no wizard: everything happens here, then the program exits
  Installed := RegQueryStringValue(HKLM, UninstKey, 'UninstallString', Uninstaller);

  if Installed then
  begin
    if MsgBox('Remove PC Monitor Agent from this computer?' + #13#10 + #13#10 +
       'This stops monitoring, removes this computer and its history from the PC Monitor ' +
       'dashboard, and deletes the program and its settings.', mbConfirmation, MB_YESNO) <> IDYES then
      Exit;

    ExtractTemporaryFile('pc-monitor-agent.exe');
    Exec(ExpandConstant('{tmp}\pc-monitor-agent.exe'),
      'unpair "' + ExpandConstant('{commonappdata}') + '\PCMonitor\config.toml"',
      '', SW_HIDE, ewWaitUntilTerminated, Code);

    Exec(RemoveQuotes(Uninstaller), '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART', '', SW_HIDE,
      ewWaitUntilTerminated, Code);
    WaitForUninstall();
  end;

  if RegKeyExists(HKLM, PawnIOKey) then
  begin
    if MsgBox('Also remove the PawnIO driver (used for CPU temperature)?' + #13#10 + #13#10 +
       'Choose No if another app such as Fan Control or LibreHardwareMonitor uses it.',
       mbConfirmation, MB_YESNO) = IDYES then
      if RegQueryStringValue(HKLM, PawnIOKey, 'QuietUninstallString', Quiet) then
        RunCommandLine(Quiet);
  end
  else if not Installed then
    MsgBox('PC Monitor Agent is not installed on this computer.', mbInformation, MB_OK);

  if not Installed then
    Exit;
  if RegKeyExists(HKLM, UninstKey) then
    MsgBox('PC Monitor Agent could not be removed completely. Try again, or remove it from ' +
      'Settings > Apps.', mbError, MB_OK)
  else
    MsgBox('PC Monitor Agent has been removed.', mbInformation, MB_OK);
end;
