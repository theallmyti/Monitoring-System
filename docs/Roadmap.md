# Roadmap — PC Monitor

v1.0 · 3 Nov → 3 Dec 2026 · ~6 h/day each
**[A]** = Aditya · **[T]** = Tirth

---

## Ownership summary

| Area | Owner |
|---|---|
| Rust agent (all collectors, service, builds) | Aditya |
| Convex: schema, auth, pairing, agent/device/live/summary/threshold/alert functions, crons | Aditya |
| Pi: agent + nightly backup | Aditya |
| Android app (all screens, Convex client, FCM receive) | Tirth |
| Convex: password reset + email action | Tirth |
| Convex: `sendPush` (FCM) action | Tirth |
| Firebase project, project Gmail account | Tirth |
| Schema changes, docs, testing | Both |

---

## Week 1 — 3 → 9 Nov · Setup + learn + spikes

| Task | Owner |
|---|---|
| Public GitHub repo, MIT licence, layout, project board | A+T |
| Convex project in existing team; invite Tirth | A |
| Rust Book ch. 1–10, 16; Tokio tutorial; Convex quickstart | A |
| Kotlin basics; Compose basics pathway; Convex quickstart | T |
| **S1** Rust prints CPU util/RAM/temp on TUF | A |
| **S2** S1 on Pi + i3 (hwmon per-core temps) | A (Pi), T (runs on i3) |
| **S3** NVML stats on RTX 3050 / 4050 | A (T runs on Strix) |
| **S4** Rust writes to Convex every 1 s; measure RAM | A |
| **S5** Convex `seed` mutation with fake stats | A |
| **S6** Compose app showing a number | T |
| **S7** App subscribes to fake stats from Convex | T |
| **S8** Firebase project; test push to Pixel + A15 | T |
| **S9** Convex Auth Password provider from native Android? | A (T tests app side) |
| **S10** Project Gmail + app password; Convex Node action sends email | T |

**Exit:** all spikes run; findings in `docs/spikes.md`.

## Week 2 — 10 → 16 Nov · Vertical slice

| Task | Owner |
|---|---|
| `convex/schema.ts` + function names agreed | A+T |
| Auth backend: sign up/in/out, sessions, rate limit | A |
| Agent: CPU temp + util, summary every 60 s, live while viewing | A |
| Agent config file | A |
| Login / sign-up screens | T |
| Device list + device detail (live CPU) + viewer flag | T |

**Exit:** Pixel on mobile data shows live CPU from TUF. 30 s video.

## Week 3 — 17 → 23 Nov · MVP data + multi-device

| Task | Owner |
|---|---|
| All collectors: CPU, GPU, RAM, usage time, disk | A |
| Capabilities, supervisor, Windows service (no-driver), systemd | A |
| Builds for Windows, Linux x64, ARM64; agents on all 4 devices | A |
| Pairing: agent `pair` + Convex `pairing.*` | A |
| Pi extras (P1) | A |
| Password reset backend + email action | T |
| Forgot-password screens | T |
| All device sections, capability-based tiles, fleet overview | T |
| Pair screen (QR scan), rename/remove | T |

**Exit:** 4 devices visible on both phones with correct tiles.

## Week 4 — 24 → 30 Nov · Alerts, battery, backup

| Task | Owner |
|---|---|
| Battery collector | A |
| Thresholds backend + per-drive disk thresholds; `alerts.evaluate` | A |
| Crons: offline (1 min), retention (daily), canary (daily) | A |
| Pi nightly export | A |
| Alert cooldown (15 min) | A |
| Release CI: agent binaries + `SHA256SUMS` | A |
| Agent auto-updater (P1) | A |
| **Stretch:** PawnIO full mode | A |
| Release CI: signed APK | T |
| `sendPush` FCM action; token registration; notifications | T |
| Threshold setup (first run) + settings screens | T |
| Alerts list; canary ack; battery section; dark mode, °C/°F | T |
| Samsung A15 battery-saver testing | T |

**Exit:** overheat + offline alerts reach both locked phones within 1 min on mobile data.

## 1 → 3 Dec · Freeze + release

| Task | Owner |
|---|---|
| Feature freeze 1 Dec — bugs only | A+T |
| Full test matrix (`Testing.md`) | A+T |
| RAM/CPU measurements in README | A |
| README, screenshots, demo video | T |
| Tag `v0.1.0`, update CHANGELOG → CI publishes GitHub Release | A |
| Install APK from GitHub Release on both phones (check Play Protect) | T |

---

## Cut order if behind

1. PawnIO full mode (already stretch)
2. Agent auto-update (if P1) → manual reinstall for v0.1.0
3. Pi extras (Docker, SMART, throttle)
4. Top 5 processes
5. Daily canary
6. Fleet overview (keep device list)

Never cut: accounts, pairing, live view, multi-device, offline alert, threshold alerts, mobile data.

---

## After 3 Dec

| Phase | Content | Owner (proposed) |
|---|---|---|
| 2 | Disk/network/fan stats, history graphs, process list, per-device alert config, remote lock/sleep/shutdown, signed releases (minisign) | A (agent/backend), T (app) |

Screen share: dropped for now.
