# Implementation Plan: Aditya's MVP scope (agent, backend, Pi)

Owner: Aditya · Deadline: 3 Dec 2026 · Sources: `docs/Roadmap.md`, `docs/SRS.md`, `docs/Architecture.md`, `docs/Database.md`, `docs/Security.md`
Task list: `tasks/todo.md`

## Overview

Turn the Week 1 spikes into the MVP described in the SRS: a Rust agent that sends a 60 s summary always and live data only while someone is watching; a Convex backend with accounts, pairing, thresholds, alerts and crons; and the Pi pieces. Tirth builds the Android app, password reset and push sending; the tasks below mark where they hand off.

## Where we are (3 Nov 2026)

- Done: S1 (CPU/RAM), S3 (NVIDIA GPU), S4 (agent → Convex), S2 partly (Pi temperature, container counts via the home dashboard). Agent runs on the laptop and in Docker on the Pi.
- Spike shortcuts that must be replaced:
  1. **Agent pushes every second, always.** Two devices = ~5.2M calls/month, above the 4.8M project cap (`Database.md` §3). Highest priority.
  2. Summary is one sample per minute, not avg/max (`Database.md` summaries).
  3. Team registration secret instead of pairing (`Flow.md` §3).
  4. Dashboard read token instead of sign-in (`Security.md` §4).
  5. No retention: summaries grow forever (FR-50).
- Known issue: laptop agent RAM ~41 MB live; target < 25 MB (NFR-01).

## Architecture decisions

- **Live only while viewing** (D3): the app/dashboard sets `viewerUntil = now + 30 s` every 15 s; the agent subscribes to it and pushes `latest` every 1 s only while it is in the future. Summaries go every 60 s regardless.
- **Summary is computed on the agent** (aggregator over 1 s samples → avg/max) so the backend only stores it (Architecture §2.2).
- **Custom email + password auth** (D6), scrypt in a Node action, sessions as SHA-256 of a random token. Pending open question 1.
- **Pairing replaces the team secret**; devices get `userId`; every query checks ownership (Security §2).
- **Schema changes stay additive** (Development §3). Spike data (`isFake: true`) is purged before Phase 2 changes the shapes.
- **Prod deploys are run by Aditya** (`npx convex deploy`); the assistant is blocked from prod writes. Dev is used to develop and test.

## Phases

1. **Data path** (quota-critical): summaries, live-while-viewing, retention.
2. **Accounts and pairing**: auth, pairing, ownership; remove both spike secrets.
3. **Thresholds and alerts**: thresholds, evaluate, cooldown, offline cron, handoff to Tirth's `sendPush`.
4. **Agent completeness**: collectors (disk, RAM details, battery, usage), capabilities, supervisor, service install, release CI, RAM fix.
5. **P1 / stretch** (only if on time): auto-update, Pi nightly export, canary, PawnIO.

## Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Quota overrun from 1 s pushes | High | Task 1–3 first; stop agents if delayed |
| Agent RAM above 25 MB | Med | Task 16 measures and trims (tokio features, ureq, NVML) |
| Prod deploys need Aditya | Med | Batch changes; one deploy per checkpoint |
| Windows auto-start/service install blocked for the assistant | Med | Aditya runs the install step; installer task documents it |
| Auth is security-critical | High | Tests for each rule; both review line by line (Security §1) |
| Pi build is slow (~20 min) | Low | Build in background; cross-compile in CI (Task 15) |

## Decisions (answered 3 Nov 2026)

1. Auth: **custom email + password** (D6).
2. Personal dashboard: read token until Task 8, then sign-in like the app.
3. Spike data (devices, latest, summaries) may be purged on dev and prod. Spike summaries are purged in Task 1 because the summary shape changes.
4. Windows: user-level auto-start now; UAC installer (Architecture §2.3a) in Phase 4.
