# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org/)

Tags: **[A]** = Aditya · **[T]** = Tirth

---

## [Unreleased]

### Added
- Project docs: PRD, SRS, Architecture, Flow, Roadmap, Security, Database, Development, Testing, CHANGELOG. [A+T]
- Repo skeleton (`agent/`, `convex/`, `android/`, `scripts/`) and `.gitignore` for secrets and build output. [A]
- Agent: S1 spike (CPU, RAM, temperature every second) and config loading from `config.toml` with the team Convex URLs. [A]
- Windows installer requirement: UAC admin prompt at install only; agent runs as the normal user. [A]
- Spike S4: agent pushes CPU/RAM to Convex every second (`spike:pushLatest`, `isFake: true`); findings in `docs/spikes.md`. [A]
- Backend: `devices` and `latest` tables (subset of Database.md) and `agent:register` / `agent:pushLatest` (read endpoint removed until pairing), authenticated by SHA-256 of the device secret. [A]
- Agent: generates a 256-bit device secret on first run and sends only its hash. [A]
- Backend deployed to prod (`tidy-newt-65`); agent config points at prod. [A]
- Security: `agent:register` needs the team registration secret; public read endpoint removed until pairing. [A]
- MIT `LICENSE` (Aditya Prasad, Tirth Patel). [A+T]

### Decided (3 Nov 2026)
- Learning project, MIT licence, MVP deadline 3 Dec 2026.
- Backend: Convex cloud (replaces planned Pi hub, iroh relay, Pangolin tunnel).
- Agent: headless Rust; Windows no-driver mode P0, PawnIO full mode stretch.
- App: Android only, Kotlin + Jetpack Compose.
- Live stats at 1 s only while a phone is watching; summaries every 60 s; 7-day retention.
- Push: FCM (removal considered, rejected due to Samsung battery saver).
- Accounts: separate per user; custom email + password; reset via Gmail SMTP.
- Thresholds: first-run setup with defaults (CPU 90 °C, GPU 85 °C, RAM 90 %); per-drive disk thresholds, default 10 % free.
- Quota: project ≤ 80 % of Convex team quota.
- Roles: Aditya = agent + Convex backend + Pi; Tirth = Android app + password reset + FCM send.
- Sessions expire after 30 days unused (sliding); reset code max 3 wrong tries; pairing code 10 min.
- Alert cooldown 15 min per device + alert type.
- Single prod Convex deployment (no dev deployment).
- Distribution: GitHub Releases (agent binaries + signed APK); agent auto-update with SHA-256 check.
- Screen share dropped for now.
- Pi keeps last 14 nightly backups.
- Agent auto-update is P1 (cut to manual reinstall if behind).
- Agent reconnect backoff 1 s → 60 s max.

### Removed
- `FEATURES.md` and `PLAN.md` — superseded by `PRD.md` and `Roadmap.md`.

---

## [0.1.0] — planned 3 Dec 2026

MVP release. See `Roadmap.md`.

<!--
Template for each release:

## [x.y.z] — YYYY-MM-DD
### Added
### Changed
### Fixed
### Removed
### Security
-->
