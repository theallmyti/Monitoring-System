# Testing — PC Monitor

v1.0 · 3 Nov 2026 · **[A]** = Aditya · **[T]** = Tirth

---

## 1. Strategy

| Level | What | Tool | Owner |
|---|---|---|---|
| Unit — agent | Aggregator math, value sanity checks, config parsing, collectors with fake sources | `cargo test` | A |
| Unit — Convex | Auth, pairing, ownership checks, threshold logic, retention | `convex-test` + Vitest | A (T for reset/push) |
| Unit — app | ViewModels, threshold defaults logic | JUnit | T |
| Integration | Agent → Convex prod deployment (fake devices flagged `isFake`) → app | Manual + scripts | A+T |
| Performance | Agent RAM / CPU | `ps`, Task Manager, CI RAM job | A |
| Device matrix | 4 devices × 2 phones | Manual checklist (§4) | A+T |
| Network | Wi-Fi, mobile data, network drop | Manual | A+T |
| Security | Checklist (§6) | Manual | A+T |

## 2. Device matrix

| Device | OS | Tests run by |
|---|---|---|
| TUF A15 | Windows 11 | A |
| Strix G16 | Windows 11 | T |
| i3 server | Debian 12 | T |
| Pi 4 | Raspberry Pi OS 64-bit | A |
| Pixel 8a | Android | A |
| Samsung A15 | Android | T |

## 3. Performance tests [A]

| Test | Method | Pass |
|---|---|---|
| Idle RAM | Agent running 10 min, no viewer → RSS | < 20 MB |
| Live RAM | Phone watching 10 min → RSS | < 25 MB |
| Idle CPU | Average over 10 min | < 0.5 % of one core |
| Live CPU | Average over 10 min | < 1 % |
| Binary size | Release build | < 15 MB |
| 24 h soak | Agent runs 24 h on each device | No crash, RAM not growing |

Record results in README table.

## 4. Manual test cases (MVP)

### Accounts
| # | Steps | Expected | Owner |
|---|---|---|---|
| T-01 | Sign up new email | Account created, threshold setup shown | T |
| T-02 | Sign in wrong password 6× | Blocked after 5 | A |
| T-03 | Forgot password → code → new password | Email arrives ≤ 1 min; old sessions signed out | T |
| T-04 | Reuse reset code; enter wrong code 4× | Reuse rejected; code dead after 3 wrong tries | T |
| T-06 | Don't open app 30 days (simulate: edit `lastUsedAt`) | Sign-in screen; devices + data still there after sign-in | A+T |
| T-05 | Sign out → back button | Can't access data | T |

### Pairing & devices
| # | Steps | Expected | Owner |
|---|---|---|---|
| T-10 | `agent pair` → scan QR | Device appears in list | A+T |
| T-11 | Scan code after 10 min | Rejected | A |
| T-12 | Tirth's account opens Aditya's device ID | Denied | A |
| T-13 | Remove device | Agent writes fail; device gone from list | A+T |
| T-14 | Pi / i3 device screen | No battery / GPU tiles | T |

### Live & data
| # | Steps | Expected | Owner |
|---|---|---|---|
| T-20 | Open device screen on mobile data | Updates every ~1 s, delay ≤ 2 s | A+T |
| T-21 | Close screen | Live pushes stop within 30 s (check Convex logs) | A |
| T-22 | Stress CPU (e.g. `stress` / Prime95) | Temp + util rise in app | A+T |
| T-23 | Kill network on PC 2 min, restore | Agent reconnects, no crash | A |
| T-24 | Compare values with HWiNFO / `sensors` | Within ±2 °C / ±5 % | A |

### Alerts
| # | Steps | Expected | Owner |
|---|---|---|---|
| T-30 | Set CPU threshold low (e.g. 40 °C), lock phone | Push ≤ 1 min | A+T |
| T-31 | Shut down a device | Offline alert after ~3 min | A+T |
| T-32 | Disk threshold on one drive | Alert for that drive only | A+T |
| T-33 | Samsung A15 locked 1 h, battery saver on | Alerts still arrive | T |
| T-34 | Canary: uninstall app on one phone | Next day "alert path broken" | A+T |
| T-35 | Keep CPU above threshold 30 min | Max 2 alerts (15-min cooldown) | A |

### Releases & updates
| # | Steps | Expected | Owner |
|---|---|---|---|
| T-50 | Push tag `v0.0.1-test` | Release with 3 agent binaries, `SHA256SUMS`, signed APK | A (agent), T (APK) |
| T-51 | Agent on old version, publish new release | Updated within 6 h (force check with `agent update --now`) | A |
| T-52 | Tamper: release with wrong checksum | Agent refuses, keeps old version | A |
| T-53 | Release with binary that crashes on start | Rolled back after 3 failed starts | A |
| T-54 | Install APK from GitHub on Pixel + A15 | Installs (Play Protect paused if needed), signs in | T |

### Retention & backup
| # | Steps | Expected | Owner |
|---|---|---|---|
| T-40 | Insert summary with old timestamp, run retention | Deleted | A |
| T-41 | Run Pi backup script | Export file on HDD | A |

## 5. Quota test [A]

- After week 2: check Convex usage per day × 30 → projected monthly.
- Must project ≤ 80 % of team quota.

## 6. Security checklist [A+T]

- [ ] Passwords stored as scrypt/argon2 hash (inspect DB)
- [ ] No secrets in repo (`git log -p | grep -i -E "key|password|secret"`)
- [ ] Every query/mutation checks ownership (code review)
- [ ] Reset response same for known/unknown emails
- [ ] Agent config file permissions restricted

## 7. Release gate (3 Dec)

- [ ] All P0 test cases pass on both phones
- [ ] Performance targets met on all 4 devices
- [ ] 24 h soak passed
- [ ] Security checklist done
- [ ] Results recorded in README
