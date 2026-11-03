# Flows — PC Monitor

v1.0 · 3 Nov 2026 · Diagrams in Mermaid (render in Obsidian / GitHub)
**[A]** = Aditya · **[T]** = Tirth

---

## 1. Sign up / sign in  — backend [A], app [T]

```mermaid
sequenceDiagram
  participant U as User
  participant App
  participant C as Convex
  U->>App: email + password
  App->>C: auth.signUp / auth.signIn
  C->>C: check rate limit (5 / 15 min)
  C->>C: hash (scrypt/argon2) or verify hash
  C-->>App: session token (expires after 30 days idle)
  App->>App: store token (EncryptedSharedPreferences)
  App-->>U: first run? → threshold setup : fleet screen
```

## 2. Password reset — [T]

```mermaid
sequenceDiagram
  participant App
  participant C as Convex
  participant G as Gmail SMTP
  App->>C: passwordReset.requestReset(email)
  C->>C: create 6-digit code, store hash, expiry 15 min
  C->>G: email.sendResetCode (Node action)
  G-->>App: email arrives in user inbox
  App->>C: passwordReset.resetPassword(email, code, newPassword)
  C->>C: verify code hash, unused, not expired, < 3 wrong tries
  C->>C: hash new password, mark code used, delete all sessions
  C-->>App: ok → sign in again
```
Same response whether email exists or not (no account enumeration).

## 3. Pair a device — agent + backend [A], app [T]

```mermaid
sequenceDiagram
  participant Ag as Agent (PC)
  participant C as Convex
  participant App
  Ag->>Ag: generate random 256-bit device secret (saved locally)
  Ag->>C: pairing.start(hash(secret), deviceInfo)
  C-->>Ag: 6-char code (expires 10 min)
  Ag->>Ag: print code + QR in terminal
  App->>App: user scans QR
  App->>C: pairing.confirm(code) [signed in]
  C->>C: create device, link to user, store secret hash
  Ag->>C: pairing.status(code) subscription
  C-->>Ag: confirmed → deviceId
  Ag->>C: agent.register(capabilities)
```
Secret never leaves the agent; Convex stores only its hash.

## 4. Live view — agent + backend [A], app [T]

```mermaid
sequenceDiagram
  participant App
  participant C as Convex
  participant Ag as Agent
  App->>C: devices.setViewer(deviceId) → viewerUntil = now+30s
  C-->>Ag: watchViewer update (viewer present)
  loop every 1 s while viewerUntil > now
    Ag->>C: agent.pushLatest (overwrite latest doc)
    C-->>App: live.get subscription update
  end
  loop every 15 s while screen open
    App->>C: devices.setViewer
  end
  Note over App: screen closed → no more setViewer
  Note over Ag: viewerUntil passes → stop live pushes
```

## 5. Summary + alert — rules [A], push [T]

```mermaid
sequenceDiagram
  participant Ag as Agent
  participant C as Convex
  participant F as FCM
  participant P as Phone
  Ag->>C: agent.pushSummary (every 60 s)
  C->>C: update lastSeenAt, online = true
  C->>C: alerts.evaluate vs user thresholds (defaults if unset)
  alt breach and no same alert in last 15 min
    C->>C: insert alert
    C->>F: push.sendPush (Node action)
    F->>P: notification (works when locked)
    P->>P: tap → device detail screen
  end
```

## 6. Offline detection — [A] cron, [T] push

```mermaid
sequenceDiagram
  participant Cron as Convex cron (1 min)
  participant C as Convex
  participant F as FCM
  Cron->>C: find devices with lastSeenAt < now - 3 min and online = true
  C->>C: set online = false, insert "offline" alert
  C->>F: push.sendPush
```

## 7. Daily canary — [A] cron, [T] ack

```mermaid
sequenceDiagram
  participant Cron as Convex cron (daily)
  participant F as FCM
  participant App
  participant C as Convex
  Cron->>F: silent test push per user
  F->>App: canary message
  App->>C: canary.ack
  Note over C: next run: no ack since last send → "alert path broken" alert
```

## 8. Retention — [A]

Daily cron deletes `summaries` older than 7 days (in batches to stay within function limits).

## 9. Backup — [A]

Pi cron (nightly) → `npx convex export` → file on Pi HDD → keep last 14 exports.

## 10. Agent auto-update — [A] (release CI: [A] agent, [T] APK)

```mermaid
sequenceDiagram
  participant Ag as Agent
  participant GH as GitHub Releases
  participant OS as systemd / Windows SCM
  loop every 6 h
    Ag->>GH: GET latest release (HTTPS)
    alt newer version
      Ag->>GH: download binary for this OS/arch + SHA256SUMS
      Ag->>Ag: verify SHA-256 — mismatch → discard, log, retry next cycle
      Ag->>Ag: keep old binary as .bak, put new one in place
      Ag->>OS: restart service
      alt new version fails to start 3×
        OS->>Ag: restore .bak, restart old version
      end
    end
  end
```
Windows: running `.exe` can't be overwritten → rename running file to `.old`, write new file, restart.

## 11. Agent startup — [A]

```
start → load config → no secret? → tell user to run `agent pair`
      → connect to Convex → agent.register(capabilities)
      → supervisor starts collectors → summary loop + viewer subscription
      → on disconnect: retry with backoff (1 s → 60 s max)
```
