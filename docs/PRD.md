# PRD — PC Monitor

**Product Requirements Document** · v1.0 · 3 Nov 2026
**Team:** Aditya, Tirth · **Deadline:** MVP working on **3 Dec 2026** · **Licence:** MIT

---

## 1. Problem

We own laptops, a home server and a Raspberry Pi. Checking temps, load or battery means sitting at each machine. When a machine overheats or goes offline while we're away, nobody knows.

## 2. Goal

A lightweight agent on every machine + an Android app that shows live hardware stats and sends alerts — from anywhere, on Wi-Fi or mobile data.

**Project goal:** learning project. Learn Rust, Kotlin and TypeScript by building it. Not a product, no commercial plans.

## 3. Users

| User | Devices | Phone |
|---|---|---|
| Aditya | ASUS TUF A15 (Windows 11), Raspberry Pi 4 (Raspberry Pi OS) | Pixel 8a |
| Tirth | ASUS ROG Strix G16 (Windows 11), i3-3210 server (Debian 12) | Samsung A15 |

Each user has a **separate account** and sees only their own devices.

## 4. Success metrics (3 Dec)

| Metric | Target |
|---|---|
| Devices visible in app | All 4 |
| Live update delay | ≤ 2 s on mobile data |
| Alert delivery | ≤ 1 min after breach, phone locked |
| Agent RAM (idle) | < 20 MB |
| Agent CPU (idle) | < 0.5 % of one core |
| Convex usage | ≤ 80 % of team quota |
| Understanding | Each author can explain every line they merged |

## 5. MVP features

Priority: **P0** = must ship 3 Dec · **P1** = ship if time · **Stretch** = only if all else done.

| # | Feature | Priority | Owner |
|---|---|---|---|
| F1 | CPU: per-core + package temp, avg/max, per-core + total util, clocks, power | P0 | Aditya |
| F2 | GPU (NVIDIA): temp, util, VRAM, power, clock, fan | P0 | Aditya |
| F3 | RAM: used/free/cached, swap, speed/type, top 5 processes | P0 | Aditya |
| F4 | Usage time: uptime, active time today, boot/sleep log | P0 | Aditya |
| F5 | Battery (laptops): %, state, health %, cycles, rate | P0 | Aditya |
| F6 | Pi extras: SoC temp, throttle flags, HDD SMART, Docker status | P1 | Aditya |
| F7 | Windows no-driver mode (no admin) | P0 | Aditya |
| F8 | Windows full mode (PawnIO driver, per-core temps) | Stretch | Aditya |
| F9 | Accounts: sign up, sign in, sign out (email + password) | P0 | Aditya (backend), Tirth (app) |
| F10 | Password reset by email code (Gmail SMTP) | P0 | Tirth |
| F11 | Device pairing by QR / code | P0 | Aditya (agent + backend), Tirth (app) |
| F12 | Device list, per-device dashboard, fleet overview | P0 | Tirth |
| F13 | Live view at 1 s, only while screen open | P0 | Aditya (agent + backend), Tirth (app) |
| F14 | Thresholds: first-run setup with defaults; per-drive disk thresholds | P0 | Aditya (backend), Tirth (app) |
| F15 | Alerts: threshold breach + device offline > 3 min | P0 | Aditya (rules), Tirth (push) |
| F16 | Push notifications via FCM | P0 | Tirth |
| F17 | Daily canary (end-to-end alert check) | P1 | Aditya (cron), Tirth (ack) |
| F18 | Summary history, kept 7 days | P0 | Aditya |
| F19 | Nightly Convex export to Pi | P1 | Aditya |
| F20 | Dark mode, °C/°F | P1 | Tirth |
| F21 | Agent auto-update from GitHub Releases (checksum-verified) | P1 | Aditya |
| F22 | Releases on GitHub: agent binaries + signed Android APK, built by CI | P0 | Aditya (agent), Tirth (APK) |
| F23 | Alert cooldown: same alert type per device max once per 15 min | P0 | Aditya |

### Default thresholds
CPU 90 °C · GPU 85 °C · RAM 90 % · Disk: per drive, GB free and/or % free, default alert below 10 % free.

## 6. Non-goals (v1)

- iOS, macOS
- Desktop UI on the PC
- Screen share, remote control, P2P
- AMD / Intel GPU stats
- Selling, accounts for other people, app store release

## 7. Constraints

- **Budget: ₹0.** Free tiers only. Only a RuPay card → no Visa/Mastercard services.
- **Time:** 30 days, ~6 h/day each, ~180 h each.
- **Skill:** both start from zero in Rust, Kotlin and TypeScript; AI-assisted coding.
- **Network:** home ISP (GTPL) blocks port forwarding → every connection must be outbound.
- **Convex quota:** shared with other active projects; this project ≤ 80 %.

## 8. After 3 Dec

| Phase | Content |
|---|---|
| 2 | Disk/network/fan stats, history graphs, process list, alert config per device, remote lock/sleep/shutdown |

Screen share: **dropped** for now.

## 9. Open questions

None right now.
