# Architecture — PC Monitor

v1.0 · 3 Nov 2026 · **[A]** = Aditya · **[T]** = Tirth

---

## 1. System overview

```
┌──────────────── Monitored devices ────────────────┐
│ TUF A15 (Win11)   Strix G16 (Win11)               │
│ i3 server (Debian 12)   Pi 4 (Raspberry Pi OS)    │
│                                                   │
│   agent (Rust)  [A]                               │
└──────────────┬────────────────────────────────────┘
               │ outbound WSS (Convex Rust client)
               ▼
┌──────────────── Convex cloud ─────────────────────┐
│ Database: users, devices, latest, summaries, ...  │
│ Functions (TypeScript):                           │
│   queries / mutations          [A]                │
│   auth + pairing               [A]                │
│   password reset + email       [T]                │
│   sendPush (FCM)               [T]                │
│ Crons: offline check, retention, canary   [A]     │
└──────┬──────────────────────┬──────────┬──────────┘
       │ outbound WSS         │ HTTPS    │ SMTP
       ▼                      ▼          ▼
┌──────────────┐       ┌──────────┐ ┌───────────┐
│ Android app  │◄──────│   FCM    │ │ Gmail     │
│ (Kotlin) [T] │ push  └──────────┘ └───────────┘
│ Pixel 8a     │
│ Samsung A15  │
└──────────────┘
```

**Key rule:** every connection is outbound to a public server → CGNAT and blocked port forwarding don't matter.

---

## 2. Agent [A]

### 2.1 Internal structure
```
agent
├── main            load config, start runtime
├── config          Convex URL, device secret, intervals (TOML file)
├── pairing         `agent pair` command: code + QR in terminal
├── supervisor      spawns + restarts collector tasks, tracks status
├── collectors/
│   ├── cpu         sysinfo + hwmon (Linux) / WMI or PawnIO (Windows)
│   ├── gpu         nvml-wrapper
│   ├── memory      sysinfo + SMBIOS (speed/type, read once)
│   ├── usage       uptime, active time, boot/sleep log
│   ├── battery     starship-battery / WMI / power_supply
│   ├── disk        drive list, free space
│   └── pi          vcgencmd, SMART, Docker (Pi only)
├── aggregator      1 s samples → 60 s summary (avg/max)
├── transport       Convex client: pushLatest, pushSummary, watchViewer
├── updater         every 6 h: check GitHub Releases → download → verify SHA-256 → swap → restart; rollback after 3 failed starts
└── service         systemd unit / Windows service wrapper
```

### 2.2 Runtime behaviour
- Collectors sample every 1 s into an in-memory ring buffer.
- Aggregator builds a summary every 60 s → `agent.pushSummary`.
- Transport subscribes to the device's viewer flag. While `viewerUntil > now`, it sends `agent.pushLatest` every 1 s.
- Supervisor restarts a crashed/stalled collector with backoff. Status included in the summary.

### 2.3 Windows modes
| Mode | Install | Per-core temps | Priority |
|---|---|---|---|
| No-driver | User-level, no admin | No (WMI approximate or hidden) | P0 |
| Full | Admin, SYSTEM service, PawnIO driver | Yes | Stretch |

### 2.3a Installer (Windows)
- The installer is a normal Windows setup program. It **asks for admin access (UAC prompt) like any other app** — it needs admin only to write to `Program Files` and register the service/startup entry.
- The installed agent then **runs as the normal user** in no-driver mode (no admin). Admin is needed only at install time, and for full mode (stretch).
- Installer manifest: `requireAdministrator` on the setup `.exe` only, never on the agent binary.

### 2.4 Build targets
`x86_64-pc-windows-msvc` (built on TUF) · `x86_64-unknown-linux-gnu` (built on i3) · `aarch64-unknown-linux-gnu` (built on Pi)

---

## 3. Backend (Convex) [A] + [T]

### 3.1 Function modules

| Module | Functions | Owner |
|---|---|---|
| `auth.ts` | `signUp`, `signIn`, `signOut`, session check helper | [A] |
| `passwordReset.ts` | `requestReset` (action), `resetPassword` (mutation) | [T] |
| `email.ts` | `sendResetCode` (internal Node action, nodemailer) | [T] |
| `pairing.ts` | `start` (agent), `confirm` (app), `status` (agent) | [A] |
| `agent.ts` | `register`, `pushLatest`, `pushSummary`, `watchViewer` | [A] |
| `devices.ts` | `list`, `get`, `rename`, `remove`, `setViewer` | [A] |
| `live.ts` | `get` (latest snapshot) | [A] |
| `summaries.ts` | `range` | [A] |
| `thresholds.ts` | `get`, `set`, `setDisk` | [A] |
| `alerts.ts` | `list`, `evaluate` (internal) | [A] |
| `push.ts` | `registerToken` (mutation), `sendPush` (internal Node action, FCM) | [T] |
| `canary.ts` | `send` (internal), `ack` (mutation) | [A] send, [T] ack |
| `crons.ts` | offline check (1 min), retention (daily), canary (daily) | [A] |

Schema: see `Database.md`.

### 3.2 Secrets (Convex environment variables)
`FCM_SERVICE_ACCOUNT_JSON` [T] · `SMTP_USER`, `SMTP_APP_PASSWORD` [T]

---

## 4. Android app [T]

### 4.1 Layers
```
UI (Compose screens)
   ↓
ViewModels (state, StateFlow)
   ↓
Repositories (AuthRepo, DeviceRepo, AlertRepo, ThresholdRepo)
   ↓
ConvexClient (single instance)  +  FirebaseMessagingService
```

### 4.2 Screens
| Screen | Purpose |
|---|---|
| Sign in / Sign up | FR-01, FR-02 |
| Forgot password → code → new password | FR-05, FR-06 |
| Threshold setup (first run) | FR-40 |
| Fleet overview | All devices, worst temp highlighted |
| Device list | Online/offline, rename/remove |
| Device detail | Live gauges; sets viewer flag every 15 s |
| Pair device | QR scan / code entry |
| Alerts | Alert history |
| Settings | Thresholds, per-drive disk thresholds, units, theme, sign out |

### 4.3 Background behaviour
- No persistent background connection.
- FCM wakes the app for alerts; the app shows a notification.
- Viewer flag sent only while the device detail screen is visible.

---

## 5. External services

| Service | Use | Owner | Cost |
|---|---|---|---|
| Convex cloud | DB + functions | [A] | Free (shared team quota) |
| Firebase (FCM) | Push | [T] | Free |
| Gmail (dedicated project account) | Reset emails via SMTP | [T] | Free |
| GitHub | Repo, CI, issues, Releases (agent binaries + APK) | [A+T] | Free |

---

## 6. Key decisions

| # | Decision | Why | Rejected |
|---|---|---|---|
| D1 | Convex cloud as the only backend | No server to run; outbound-only beats CGNAT | Pi hub + iroh relay; Pangolin; Cloudflare quick tunnel |
| D2 | Rust agent, headless | Lowest RAM; single binary | Electron (150–300 MB), Python |
| D3 | Live data only while viewing | Keeps Convex calls inside quota | Always-on 1 s (~10M calls/month) |
| D4 | Overwrite `latest`, insert `summaries` | Flat storage for live data | Insert every second |
| D5 | FCM for alerts | Survives Android Doze + Samsung battery saver | Foreground service, ntfy |
| D6 | Custom email + password | Learning; no extra provider | Auth0 |
| D7 | Gmail SMTP for reset | No domain needed | Resend (needs domain) |
| D8 | PawnIO full mode = stretch | High risk, admin install | P0 per-core temps on Windows |
| D9 | Single prod Convex deployment | Team choice, simpler | Dev + prod |
| D10 | Distribution via GitHub Releases + agent auto-update | Free, no store | Play Store, manual updates |

---

## 7. Future (after 3 Dec)

- Phase 2 features only (see `Roadmap.md`).
- Screen share dropped for now.
