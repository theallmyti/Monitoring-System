# Development Guide — PC Monitor

v1.0 · 3 Nov 2026 · **[A]** = Aditya · **[T]** = Tirth

---

## 1. Repo layout

```
pc-monitor/
  agent/      Rust agent                  [A]
  convex/     Convex schema + functions   [A] (+ [T]: passwordReset, email, push)
  android/    Kotlin app                  [T]
  scripts/    Pi backup, install scripts  [A]
  docs/       all .md docs                [A+T]
  LICENSE     MIT
```

## 2. Setup

### Aditya (TUF A15, Windows 11)
- [ ] Git, GitHub account
- [x] Rust via rustup (`stable`), components `clippy`, `rustfmt` — installed 3 Nov 2026 (rustc 1.99.1, `winget install Rustlang.Rustup`)
- [ ] Visual Studio Build Tools (C++) — needed for Rust on Windows
- [ ] Node.js LTS + `npm i convex` in `convex/`
- [ ] VS Code + rust-analyzer
- [ ] SSH to Pi (`ssh homeserver`) for ARM64 builds

### Tirth (Strix G16, Windows 11)
- [ ] Git, GitHub account
- [ ] Android Studio + JDK 17+
- [ ] Node.js LTS (for Convex TypeScript work)
- [ ] Phone in developer mode (USB debugging) — Samsung A15
- [ ] SSH to i3 server for Linux agent tests

## 3. Running locally

| Part | Command | Owner |
|---|---|---|
| Deploy Convex functions (prod) | `cd convex && npx convex deploy` — from `main` only, after PR review | A |
| Agent | `cd agent && copy config.example.toml config.toml && cargo run` (reads `config.toml`, or pass a path as the first argument) | A |
| Agent pairing | `cargo run -- pair` | A |
| Android | Open `android/` in Android Studio → Run on phone | T |
| Fake data for app | `npx convex run seed:fakeStats` | A (written), T (uses) |

**Single prod deployment** (team decision). Rules that come with it:
- Deploy only from `main`, after review.
- Schema changes must be backward-compatible (add optional fields; never rename/remove a field agents still send).
- Seed/fake data flagged `isFake: true`, deleted before week 3.
- Risk accepted: a bad deploy breaks live devices immediately.

## 4. Environment variables (Convex dashboard, never in git)

| Variable | Set by |
|---|---|
| `FCM_SERVICE_ACCOUNT_JSON` | T |
| `SMTP_USER`, `SMTP_APP_PASSWORD` | T |

## 5. Git workflow

- `main` is protected: no direct push.
- Branches: `agent/<topic>`, `convex/<topic>`, `android/<topic>`, `docs/<topic>`.
- Commits: Conventional Commits — `feat(agent): add gpu collector`, `fix(android): crash on empty list`.
- Every PR:
  - What changed
  - How it was tested
  - Agent PRs: RAM/CPU impact
  - Reviewed by the other person
- Schema (`convex/schema.ts`) PRs need both approvals.
- Auth PRs: reviewed line by line by both.

## 6. AI-assisted coding rules

1. AI may write code.
2. **Nothing merges until the author can explain every line** to the other person.
3. Paste errors to AI with the full message + the code — not just "it doesn't work".
4. If AI suggests a new library, check its licence and last release date first.
5. Never paste secrets (tokens, passwords, keys) into an AI chat.

## 7. Code style

| Language | Tools |
|---|---|
| Rust | `cargo fmt`, `cargo clippy -- -D warnings` |
| TypeScript | `prettier`, `tsc --noEmit` |
| Kotlin | Android Studio formatter, `ktlint` (optional) |

## 8. CI (GitHub Actions)

| Job | Checks | Owner |
|---|---|---|
| agent | `cargo fmt --check`, `clippy`, `test`, build Linux x64 | A |
| agent-ram | run agent 60 s with fake collectors, fail if RSS > 20 MB | A |
| convex | `tsc --noEmit`, unit tests (`convex-test`) | A |
| android | `./gradlew assembleDebug`, unit tests | T |

## 9. Builds

| Target | Where | Owner |
|---|---|---|
| Windows x64 | TUF (`cargo build --release`) | A |
| Linux x64 | i3 (`cargo build --release`) | A (Tirth runs it on i3) |
| Linux ARM64 | Pi (`cargo build --release`) — slow, use `--jobs 2` | A |
| Android debug APK | Android Studio | T |

Note: Google Play Protect may block sideloaded APKs on some phones in India. Install via Android Studio / `adb install` during development; for GitHub APKs, pause Play Protect scanning while installing if blocked.

## 9.1 Releases (GitHub Releases)

1. Update `CHANGELOG.md`, bump versions (`agent/Cargo.toml`, `android` versionCode/versionName).
2. Tag on `main`: `git tag v0.1.0 && git push --tags`.
3. GitHub Actions builds:
   - Agent: Windows x64, Linux x64, Linux ARM64 (via `cross`) + `SHA256SUMS` [A]
   - Android: release APK signed with keystore from Actions secrets [T]
4. Release published automatically; installed agents pick it up within 6 h (auto-update).

## 10. Daily routine

- 15-min sync: done / next / blocked.
- Blocked > 2 h → ask.
- New idea → issue labelled `after-dec-3`.
- Monday: check Convex usage page (must stay ≤ 80 % of quota).

## 11. Docs

- Update the relevant `.md` when behaviour changes.
- Update `CHANGELOG.md` in every PR that changes behaviour.
