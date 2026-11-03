// "Pair this computer" wizard page, included in [Code] by pc-monitor-agent.iss.
// Runs `pc-monitor-agent pair --ui <dir> <config>` hidden; every second it reads <dir>\status.txt
// and shows the QR code image (<dir>\qr.bmp), the code, a countdown and the state.
// Timer: SetTimer + CreateCallback, as in Inno Setup's Examples\CodeDll.iss.

var
  PairPage: TWizardPage;
  QRImage: TBitmapImage;
  CodeLabel, HintLabel, TimerLabel, StatusLabel: TNewStaticText;
  PairTimer: LongWord;
  Paired: Boolean;
  ShownCode, PairFolder: String;

function SetTimer(hWnd, nIDEvent, uElapse, lpTimerFunc: LongWord): LongWord;
  external 'SetTimer@user32.dll stdcall';
function KillTimer(hWnd, uIDEvent: LongWord): BOOL;
  external 'KillTimer@user32.dll stdcall';

function StatusValue(Lines: TArrayOfString; Key: String): String;
var
  I: Integer;
begin
  Result := '';
  for I := 0 to GetArrayLength(Lines) - 1 do
    if Pos(Key + '=', Lines[I]) = 1 then
    begin
      Result := Copy(Lines[I], Length(Key) + 2, MaxInt);
      Exit;
    end;
end;

function MinutesSeconds(Value: String): String;
var
  N: Integer;
begin
  N := StrToIntDef(Value, 0);
  Result := Format('%d:%.2d', [N div 60, N mod 60]);
end;

procedure StopPairTimer();
begin
  if PairTimer <> 0 then
    KillTimer(0, PairTimer);
  PairTimer := 0;
end;

procedure ShowPaired();
begin
  Paired := True;
  StopPairTimer();
  TimerLabel.Caption := '';
  HintLabel.Caption := 'Monitoring starts when you click Next.';
  StatusLabel.Font.Color := clGreen;
  StatusLabel.Caption := 'Paired. This computer is now linked to PC Monitor.';
  WizardForm.NextButton.Caption := SetupMessage(msgButtonNext);
end;

// Every second: read the agent's status file and show the current code, countdown and state.
procedure PairTick(Wnd, Msg, IdEvent, Time: LongWord);
var
  Lines: TArrayOfString;
  State, Code: String;
begin
  if not LoadStringsFromFile(PairFolder + '\status.txt', Lines) then
    Exit;
  State := StatusValue(Lines, 'state');
  Code := StatusValue(Lines, 'code');
  if (State = 'pending') and (Code <> ShownCode) and FileExists(PairFolder + '\qr.bmp') then
    try
      QRImage.Bitmap.LoadFromFile(PairFolder + '\qr.bmp');
      QRImage.Visible := True;
      CodeLabel.Caption := Code;
      ShownCode := Code;
    except
      Log('QR image not ready yet');
    end;
  if State = 'pending' then
  begin
    TimerLabel.Caption := 'Code expires in ' + MinutesSeconds(StatusValue(Lines, 'left')) +
      '. A new code appears automatically.';
    StatusLabel.Caption := 'Waiting for your phone...';
  end
  else if State = 'paired' then
    ShowPaired()
  else if StatusValue(Lines, 'message') <> '' then
    StatusLabel.Caption := StatusValue(Lines, 'message');
end;

procedure CreatePairingPage(AfterID: Integer);
begin
  PairPage := CreateCustomPage(AfterID, 'Pair this computer',
    'Link this computer to your PC Monitor by scanning the QR code with your phone.');

  QRImage := TBitmapImage.Create(PairPage);
  QRImage.Parent := PairPage.Surface;
  QRImage.Left := 0;
  QRImage.Top := 0;
  QRImage.Width := ScaleY(210);
  QRImage.Height := ScaleY(210);
  QRImage.Stretch := True;
  QRImage.BackColor := clWhite;
  QRImage.Visible := False;

  CodeLabel := TNewStaticText.Create(PairPage);
  CodeLabel.Parent := PairPage.Surface;
  CodeLabel.Left := QRImage.Width + ScaleX(24);
  CodeLabel.Top := ScaleY(4);
  CodeLabel.Font.Size := 22;
  CodeLabel.Font.Style := [fsBold];
  CodeLabel.Caption := '';

  HintLabel := TNewStaticText.Create(PairPage);
  HintLabel.Parent := PairPage.Surface;
  HintLabel.Left := CodeLabel.Left;
  HintLabel.Top := ScaleY(52);
  HintLabel.Width := PairPage.SurfaceWidth - CodeLabel.Left;
  HintLabel.AutoSize := False;
  HintLabel.Height := ScaleY(60);
  HintLabel.WordWrap := True;
  HintLabel.Caption := 'On your phone, open PC Monitor, tap "Pair device" and scan this QR code, ' +
    'or type the code.';

  TimerLabel := TNewStaticText.Create(PairPage);
  TimerLabel.Parent := PairPage.Surface;
  TimerLabel.Left := CodeLabel.Left;
  TimerLabel.Top := ScaleY(120);
  TimerLabel.Width := HintLabel.Width;
  TimerLabel.AutoSize := False;
  TimerLabel.Height := ScaleY(40);
  TimerLabel.WordWrap := True;
  TimerLabel.Caption := '';

  StatusLabel := TNewStaticText.Create(PairPage);
  StatusLabel.Parent := PairPage.Surface;
  StatusLabel.Left := CodeLabel.Left;
  StatusLabel.Top := ScaleY(166);
  StatusLabel.Width := HintLabel.Width;
  StatusLabel.AutoSize := False;
  StatusLabel.Height := ScaleY(44);
  StatusLabel.WordWrap := True;
  StatusLabel.Font.Style := [fsBold];
  StatusLabel.Caption := 'Getting a pairing code...';
end;

// Called when the page is shown: start the agent in pairing mode and the 1 s timer.
procedure StartPairing(AgentExe, Folder, ConfigPath: String);
var
  Code: Integer;
begin
  Paired := False;
  ShownCode := '';
  PairFolder := Folder;
  DelTree(PairFolder, True, True, True);
  WizardForm.NextButton.Caption := 'Skip';
  Exec(AgentExe, 'pair --ui "' + PairFolder + '" "' + ConfigPath + '"', '', SW_HIDE, ewNoWait, Code);
  PairTimer := SetTimer(0, 0, 1000, CreateCallback(@PairTick));
end;

// Stops the pairing process (if still running) and the timer.
procedure StopPairing();
begin
  StopPairTimer();
  if (PairFolder <> '') and DirExists(PairFolder) then
    SaveStringToFile(PairFolder + '\cancel', '', False);
end;

// Next / Skip on the page. Returns False to stay on the page.
function FinishPairingPage(): Boolean;
begin
  Result := True;
  if not Paired then
  begin
    if MsgBox('Skip pairing for now?' + #13#10 + #13#10 + 'The agent stays installed and starts ' +
       'sending data once this computer is paired. Run setup again to pair it later.',
       mbConfirmation, MB_YESNO) <> IDYES then
    begin
      Result := False;
      Exit;
    end;
  end;
  StopPairing();
end;
