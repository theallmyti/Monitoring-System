# SRS — PC Monitor

**Software Requirements Specification** · v1.0 · 3 Nov 2026
Owners in brackets: **[A]** = Aditya · **[T]** = Tirth · **[A+T]** = both

---

## 1. Introduction

### 1.1 Purpose
Defines what the PC Monitor system must do for the MVP due 3 Dec 2026. Source of truth for building and testing.

### 1.2 Scope
Three parts:
- **Agent** — Rust background service on Windows 11, Debian 12, Raspberry Pi OS (ARM64).
- **Backend** — Convex cloud: database, TypeScript functions, crons, actions.
- **App** — Android, Kotlin + Jetpack Compose.

### 1.3 Definitions

| Term | Meaning |
|---|---|
| Agent | Program on a monitored machine that collects and sends stats |
| Device | One monitored machine |
| Live stats | Full snapshot sent every 1 s while a phone is watching |
| Summary | Per-minute averages/maxima, always sent |
| Viewer flag | `viewerUntil` timestamp set by the app while a device screen is open |
| No-driver mode | Windows agent without kernel driver; no per-core temps |
| Full mode | Windows agent with PawnIO driver; per-core temps |
| Canary | Daily test push to prove the alert path works |

### 1.4 References
`PRD.md`, `Architecture.md`, `Database.md`, `Security.md`, `Flow.md`.

---

## 2. Overall description

### 2.1 Product perspective
```
Agents ──outbound WSS──► Convex cloud ◄──outbound WSS── Android app
                              │
                              ├─► FCM (push)
                              └─► Gmail SMTP (reset codes)
```

### 2.2 User classes
Two users (Aditya, Tirth), each with their own account and devices. No admin role.

### 2.3 Operating environment

| Part | Environment |
|---|---|
| Agent | Windows 11 x64, Debian 12 x64, Raspberry Pi OS 64-bit (ARM64) |
| App | Android (Pixel 8a, Samsung A15) |
| Backend | Convex cloud (shared team quota) |

### 2.4 Constraints
₹0 budget · RuPay card only · no inbound connections (CGNAT / blocked port forwarding) · 30-day timeline · team new to all three languages.

### 2.5 Assumptions
- Convex Rust and Android clients work for our use (verified in week 1 spikes).
- FCM free tier available without a card.
- Gmail SMTP reachable from Convex Node actions (verified in spike S10).

---

## 3. Functional requirements

### 3.1 Accounts
| ID | Requirement | Owner |
|---|---|---|
| FR-01 | User can sign up with email + password (min 8 chars). | [A] backend, [T] app |
| FR-02 | User can sign in and receives a session that expires after 30 days without opening the app (each use resets the 30 days). Expired → sign in again; devices and data unaffected. | [A] backend, [T] app |
| FR-03 | User can sign out; session is invalidated server-side. | [A] backend, [T] app |
| FR-04 | Sign-in attempts limited to 5 per 15 min per email. | [A] |
| FR-05 | User can request a password reset; a 6-digit code is emailed, valid 15 min, single use, max 3 wrong tries. | [T] |
| FR-06 | User can set a new password with a valid reset code; all sessions are then invalidated. | [T] |

### 3.2 Pairing & devices
| ID | Requirement | Owner |
|---|---|---|
| FR-10 | Agent `pair` command shows a code + QR in the terminal. | [A] |
| FR-11 | Signed-in user scans QR (or types code) to link the device to their account. | [T] app, [A] backend |
| FR-12 | Pairing code expires after 10 min. | [A] |
| FR-13 | User sees a list of their devices with online/offline status. | [T] |
| FR-14 | User can rename or remove a device; removing revokes the device secret. | [T] app, [A] backend |
| FR-15 | Agent reports capabilities (battery, GPU, per-core temps, mode, drives, Pi) at startup. | [A] |
| FR-16 | App shows only tiles the device supports. | [T] |

### 3.3 Data collection (agent)
| ID | Requirement | Owner |
|---|---|---|
| FR-20 | Collect CPU util (total, per core), clock per core, package temp, power. | [A] |
| FR-21 | Collect per-core temps on Linux (hwmon) and on Windows full mode. | [A] |
| FR-22 | Collect NVIDIA GPU temp, util, VRAM, power, clock, fan via NVML. | [A] |
| FR-23 | Collect RAM used/free/cached, swap, speed/type, top 5 processes by RAM. | [A] |
| FR-24 | Collect uptime, active time today, boot/sleep events. | [A] |
| FR-25 | Collect battery %, state, health %, cycles, rate on laptops. | [A] |
| FR-26 | Collect drive list with size and free space. | [A] |
| FR-27 | Pi: SoC temp, throttle flags, HDD SMART, Docker container states. (P1) | [A] |
| FR-28 | Reject impossible values (temp < 0 or > 125 °C, util > 100 %). | [A] |

### 3.4 Data transport
| ID | Requirement | Owner |
|---|---|---|
| FR-30 | Agent sends a summary every 60 s, always. | [A] |
| FR-31 | Agent sends live stats every 1 s only while `viewerUntil > now`. | [A] |
| FR-32 | Live stats overwrite one `latest` document per device. | [A] |
| FR-33 | App sets `viewerUntil = now + 30 s` every 15 s while a device screen is open. | [T] |
| FR-34 | Agent and app reconnect automatically after network loss. | [A] agent, [T] app |

### 3.5 Thresholds & alerts
| ID | Requirement | Owner |
|---|---|---|
| FR-40 | First app run shows threshold setup pre-filled with defaults (CPU 90 °C, GPU 85 °C, RAM 90 %). | [T] |
| FR-41 | Each drive of each device gets a disk threshold (GB free and/or % free); default 10 % free. | [T] app, [A] backend |
| FR-42 | User-set values override defaults; unset values use defaults. | [A] |
| FR-43 | Each summary is checked against thresholds; breach creates an alert. | [A] |
| FR-44 | Device with no summary for 3 min is marked offline and an alert is created. | [A] |
| FR-45 | Every new alert is pushed via FCM to the owner's phones. | [T] |
| FR-46 | Tapping a notification opens that device's screen. | [T] |
| FR-47 | Daily canary push; app acknowledges; missing ack creates an alert. (P1) | [A] cron, [T] ack |
| FR-48 | Same alert type for the same device fires at most once per 15 min. | [A] |

### 3.6 History & backup
| ID | Requirement | Owner |
|---|---|---|
| FR-50 | Summaries older than 7 days are deleted daily. | [A] |
| FR-51 | Nightly Convex export saved to the Pi's HDD; last 14 kept. (P1) | [A] |

### 3.7 Releases & updates
| ID | Requirement | Owner |
|---|---|---|
| FR-60 | Pushing a `vX.Y.Z` tag builds agent binaries (Windows x64, Linux x64, Linux ARM64) + `SHA256SUMS` and publishes a GitHub Release. | [A] |
| FR-61 | Same tag builds a release-signed Android APK and attaches it to the release. | [T] |
| FR-62 | Agent checks GitHub Releases for a newer version every 6 h. (P1) | [A] |
| FR-63 | Agent downloads only from the project's GitHub Releases over HTTPS and verifies SHA-256 before installing. | [A] |
| FR-64 | Agent replaces its binary and restarts via systemd / Windows SCM. | [A] |
| FR-65 | If the new version fails to start 3 times, the previous binary is restored. | [A] |

---

## 4. Non-functional requirements

| ID | Category | Requirement | Owner |
|---|---|---|---|
| NFR-01 | Performance | Agent RAM < 20 MB idle, < 25 MB while live | [A] |
| NFR-02 | Performance | Agent CPU < 0.5 % idle, < 1 % while live | [A] |
| NFR-03 | Performance | Agent binary < 15 MB | [A] |
| NFR-04 | Latency | Live view delay ≤ 2 s on mobile data | [A+T] |
| NFR-05 | Latency | Alert reaches phone ≤ 1 min after breach | [A+T] |
| NFR-06 | Reliability | Agent restarts automatically after crash (systemd / Windows SCM) | [A] |
| NFR-07 | Reliability | One failing collector doesn't stop others | [A] |
| NFR-08 | Quota | Project ≤ 80 % of Convex team quota per month | [A] |
| NFR-09 | Security | See `Security.md`; passwords hashed with scrypt/argon2 | [A+T] |
| NFR-10 | Portability | Agent builds for Windows x64, Linux x64, Linux ARM64 | [A] |
| NFR-11 | Usability | Alerts work with phone locked, incl. Samsung battery saver | [T] |
| NFR-12 | Maintainability | Every merged line explainable by its author; PR reviewed by the other | [A+T] |

---

## 5. External interfaces

| Interface | Used by | Purpose |
|---|---|---|
| Convex WebSocket (Rust client) | Agent | Mutations, viewer-flag subscription |
| Convex WebSocket (Android client) | App | Queries, subscriptions, mutations |
| FCM HTTP v1 API | Convex action | Push alerts |
| Gmail SMTP (465/587) | Convex Node action | Reset-code emails |
| sysinfo / NVML / hwmon / WMI / PawnIO | Agent | Hardware data |
| `vcgencmd`, Docker socket, smartctl | Pi agent | Pi extras |

---

## 6. Acceptance (3 Dec)

- [ ] All P0 FRs pass manual tests in `Testing.md`.
- [ ] NFR-01 to NFR-05 measured and recorded.
- [ ] Both phones receive an alert with screen locked on mobile data.
- [ ] Both users can explain their merged code.
