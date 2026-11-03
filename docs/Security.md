# Security — PC Monitor

v1.0 · 3 Nov 2026 · **[A]** = Aditya · **[T]** = Tirth
Auth code is security-critical: **every auth PR is reviewed line by line by both.**

---

## 1. What we protect

| Asset | Why |
|---|---|
| User passwords | Reused elsewhere by users |
| Session tokens | Full account access |
| Device secrets | Let an attacker write fake stats as a device |
| FCM service-account key | Lets anyone send pushes as our project |
| Gmail app password | Lets anyone send mail as our account |
| Hardware stats | Low sensitivity, but private |

## 2. Threats

| Threat | Mitigation | Owner |
|---|---|---|
| Password database leak | scrypt/argon2 hashes, never plain or SHA-256 | A |
| Brute-force login | 5 attempts / 15 min per email | A |
| Account enumeration | Same response for unknown email on sign-in and reset | A, T |
| Reset-code guessing | 6 digits, 15 min expiry, single use, 3 tries per code | T |
| Malicious agent update | Download only from our GitHub Releases over HTTPS; verify SHA-256 from `SHA256SUMS`; releases created only by CI from tagged `main` | A |
| Fake APK | APK signed with our release keystore; keystore only in GitHub Actions secrets | T |
| Stolen session token | Expiry after 30 days idle; sign-out deletes it; password reset deletes all | A |
| Fake device writes | Each agent has a 256-bit secret; Convex stores SHA-256 hash; every agent call checks it | A |
| User reads another user's devices | Every query/mutation checks `device.userId == session.userId` | A |
| Secrets leaked via public repo | Secrets only in Convex env vars / local config; `.gitignore`; GitHub secret scanning on | A+T |
| Malicious QR / pairing hijack | Code expires 10 min; confirm requires signed-in user; device name shown before confirm | A, T |
| Quota exhaustion (DoS) | Rate-limit agent pushes server-side (max 1 live/s, 1 summary/50 s per device) | A |

## 3. Passwords [A]

- Hash: **scrypt or argon2id** (via Convex Auth Password provider if spike S9 works; otherwise own implementation in a Node action).
- Never log passwords or hashes.
- Minimum 8 characters.
- Why not SHA-256: fast hashes can be brute-forced quickly. Slow, salted hashes can't.

## 4. Sessions [A]

- Random 256-bit token, sent once to the app.
- Convex stores SHA-256 of the token (OK here: token is random, not a human password).
- App stores token in **EncryptedSharedPreferences** [T].
- Expire after 30 days without use.

## 5. Password reset [T]

- 6-digit code, hashed in DB, 15 min expiry, single use, max 3 wrong tries.
- Success → delete all user sessions.
- Gmail: dedicated project account, 2FA on, app password in Convex env vars.

## 6. Device secrets [A]

- Generated on the agent during `agent pair`, stored in the agent config file.
- Config file permissions: owner read only (Linux `chmod 600`; Windows: user/SYSTEM only).
- Device removal deletes the hash → agent can no longer write.

## 7. Secrets management

| Secret | Location | Owner |
|---|---|---|
| `FCM_SERVICE_ACCOUNT_JSON` | Convex env var | T |
| `SMTP_USER`, `SMTP_APP_PASSWORD` | Convex env var | T |
| Device secret | Agent config file on each device | A |
| Session token | Phone EncryptedSharedPreferences | T |
| Convex deploy key | Local only / GitHub Actions secret | A |
| Android release keystore + passwords | GitHub Actions secrets (backup copy offline, never in git) | T |

Note: checksum alone only proves the file wasn't corrupted, not who made it — if GitHub account is compromised, attacker can replace both. Phase 2: sign releases (e.g. minisign) and embed public key in agent.

Rules: no secrets in git · share secrets between you two only via a private channel · rotate if leaked.

## 8. Transport

- All traffic TLS (Convex, FCM, SMTP over TLS).
- Convex (the company) can technically read stored data — accepted for hardware stats.

## 9. Agent privileges [A]

- **Installer**: Windows UAC prompt asks the user to allow admin, like any app. Admin is used only to install; the installer is the only admin-elevated binary.
- **No-driver mode** (P0): runs as the user, no admin.
- **Full mode** (stretch): SYSTEM service + PawnIO kernel driver → install only from our own build; document clearly.
- Agent never executes commands from the server in v1.

## 10. Public repo hygiene

- [ ] `.gitignore`: `.env*`, `*.toml` configs with secrets, `google-services.json` (decide), keystores.
- [ ] GitHub secret scanning + push protection enabled.
- [ ] Before each PR: `git diff` checked for secrets.

## 11. If a secret leaks

1. Rotate it immediately (new app password / new FCM key / delete sessions / re-pair device).
2. Remove from git history if committed.
3. Note it in CHANGELOG under "Security".

## 12. Later (Phase 2+)

- Remote commands signed by the phone, verified by the agent.
- Per-device permission toggles, off by default.
