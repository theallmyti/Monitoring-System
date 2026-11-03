# Tasks: Aditya's MVP scope

Plan: `tasks/plan.md`. Each task leaves the system working. Verify on the dev deployment; Aditya deploys prod at each checkpoint.

Common verification commands:
- Agent: `cd agent && cargo test && cargo clippy --all-targets -- -D warnings`
- Backend: `cd convex && npx tsc --noEmit -p . && npx vitest run` (convex-test, added in Task 1)
- Dashboard: `cd dashboard && npm run build`

## Phase 1: Data path (quota-critical)

### Task 1: Backend: summaries with avg/max, viewer flag
- [x] `agent:pushSummary` stores one row per minute with Database.md fields (cpuUtilAvg/Max, cpuTempAvg/Max, gpuTempMax, gpuUtilAvg, ramPctAvg/Max) and updates `lastSeenAt`
- [x] `devices.viewerUntil` (optional); `agent:watchViewer` returns it for the device's secret hash; `dashboard:setViewer` sets now + 30 s (token-gated until Task 8)
- [x] `pushLatest` no longer writes summaries; convex-test tests cover all three functions
- **Files:** `convex/convex/schema.ts`, `agent.ts`, `dashboard.ts`, `convex/convex/agent.test.ts`, `convex/package.json`
- **Depends on:** none · **Size:** M

### Task 2: Agent: aggregator, summary loop, live only while viewing
- [x] 1 s samples are aggregated to a 60 s avg/max summary (unit-tested), sent via `agent:pushSummary`
- [x] Live `pushLatest` runs only while `viewerUntil > now` (subscription to `agent:watchViewer`)
- [x] Reconnects with backoff 1 s → 60 s after network loss (FR-34)
- **Files:** `agent/src/aggregator.rs`, `agent/src/main.rs`, `agent/src/transport.rs`
- **Depends on:** 1 · **Size:** M

### Task 3: Dashboard heartbeat and online status; retention cron
- [x] Dashboard calls `setViewer` every 15 s while open; charts read the new summary fields
- [x] Online = `lastSeenAt` within 3 min
- [x] Daily cron deletes summaries older than 7 days, in batches (FR-50), with a test
- **Files:** `dashboard/src/*`, `convex/convex/crons.ts`, `convex/convex/summaries.ts`
- **Depends on:** 1, 2 · **Size:** M

### Checkpoint A
- [ ] All tests pass; agent on laptop and Pi updated; Aditya deploys prod
- [ ] Convex usage projected below 80 % of quota (Testing.md §5)
- [x] Live pushes stop within 30 s of closing the dashboard (T-21) — verified 3 Nov

## Phase 2: Accounts and pairing

### Task 4: Auth: sign up (scrypt) and sessions
- [ ] `users`, `sessions` tables; `auth.signUp` hashes with scrypt in a Node action; min 8 chars (FR-01)
- [ ] Returns a random 256-bit token; only its SHA-256 is stored (Security §4)
- [ ] Tests: duplicate email rejected, password never stored in plain text
- **Depends on:** Checkpoint A, open question 1 · **Size:** M

### Task 5: Auth: sign in with rate limit, sign out, session helper
- [ ] `auth.signIn`: 5 attempts / 15 min per email (FR-04); same error for unknown email and wrong password
- [ ] `auth.signOut` deletes the session; helper `requireUser(ctx, token)` enforces 30-day sliding expiry (FR-02, FR-03)
- [ ] Tests for each rule (T-02, T-06)
- **Depends on:** 4 · **Size:** M

### Task 6: Pairing backend
- [ ] `pairing.start` (agent: secret hash + device info → 6-char code, 10 min expiry), `pairing.confirm` (signed-in user), `pairing.status` (agent subscription)
- [ ] Confirm creates the device with `userId`; expired codes rejected (FR-12, T-11)
- **Depends on:** 5 · **Size:** M

### Task 7: Agent `pair` command with QR
- [ ] `pc-monitor-agent pair` generates the secret, calls `pairing.start`, prints code + QR, waits for confirmation, saves config
- [ ] Normal start without a paired device prints how to pair (Flow §11)
- **Depends on:** 6 · **Size:** S

### Task 8: Ownership everywhere; remove spike secrets
- [ ] `devices.list/get/rename/remove/setViewer` require a session and check `device.userId` (T-12, T-13)
- [ ] Registration secret and dashboard read token removed; dashboard signs in like the app
- [ ] Spike data purged (open question 3)
- **Depends on:** 7, open questions 2–3 · **Size:** M

### Checkpoint B
- [ ] Pair laptop and Pi through the real flow; Tirth's app can sign in and list devices
- [ ] Security checklist items for auth pass (Testing.md §6); Aditya deploys prod

## Phase 3: Thresholds and alerts

### Task 9: Thresholds with defaults
- [ ] `thresholds.get/set` (CPU 90 °C, GPU 85 °C, RAM 90 %), `setDisk` per drive (10 % free default) (FR-40–42)
- **Depends on:** 8 · **Size:** S

### Task 10: Alert evaluation and cooldown
- [ ] `alerts.evaluate` runs on each summary; creates cpuTemp/gpuTemp/ram/disk alerts; skips same device + type within 15 min (FR-43, FR-48, T-35)
- [ ] Calls Tirth's `push.sendPush` when it exists (stub until then)
- **Depends on:** 9 · **Size:** M

### Task 11: Offline cron
- [ ] Every minute: devices with `lastSeenAt` older than 3 min → `online = false` + offline alert (FR-44, T-31)
- **Depends on:** 10 · **Size:** S

### Checkpoint C
- [ ] Low CPU threshold triggers an alert within 1 minute; offline alert after ~3 min; Aditya deploys prod

## Phase 4: Agent completeness

### Task 12: Disk collector and capabilities
- [x] Drive list with size/free (FR-26); `agent.register` reports capabilities (battery, GPU, per-core temps, mode, drives, Pi) (FR-15)
- [x] Also done here: per-core CPU use and clocks (FR-20), RAM/swap detail and top 5 processes (FR-23), uptime (FR-24)
- **Size:** M

### Task 13: RAM details, usage time, battery
- [x] Battery on laptops (FR-25): charge, charging, health, cycles (when Windows reports them), power rate; charge in summaries
- [ ] Active time today and boot/sleep log (FR-24). RAM detail and uptime were done in Task 12.
- **Size:** M

### Task 14: Supervisor
- [ ] Each collector runs isolated; a failing one is restarted with backoff and reported in `collectorStatus` (NFR-07)
- **Size:** M

### Task 15: Service install and release CI
- [ ] systemd unit (Linux), user-level auto-start (Windows), Pi Docker kept
- [ ] GitHub Actions: tag `vX.Y.Z` builds Windows x64, Linux x64, ARM64 + `SHA256SUMS` (FR-60, T-50)
- **Size:** M

### Task 16: RAM and CPU targets
- [ ] Measure idle and live RSS/CPU on all devices (Testing.md §3); fix the laptop's ~41 MB; record results in README
- **Size:** S

### Checkpoint D (feature freeze 1 Dec)
- [ ] All P0 test cases in Testing.md pass; 24 h soak on each device; Aditya deploys prod; tag `v0.1.0`

## Phase 5: P1 / stretch (only if on time)
- [ ] Task 17: Agent auto-update from GitHub Releases with SHA-256 check and rollback (FR-62–65)
- [ ] Task 18: Pi nightly Convex export, keep 14 (FR-51)
- [ ] Task 19: Daily canary send (FR-47), ack is Tirth's
- [ ] Task 20: Windows full mode with PawnIO (stretch)
