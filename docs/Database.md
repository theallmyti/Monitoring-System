# Database — PC Monitor (Convex)

v1.0 · 3 Nov 2026 · Schema owner: **Aditya** · Changes need **Aditya + Tirth** approval
Tables marked **[T]** are written by Tirth's functions.

> If spike S9 (Convex Auth Password provider) succeeds, Convex Auth's own auth tables replace `users`, `sessions`, `passwordResets` and `loginAttempts` below.

---

## 1. Tables

### users [A]
| Field | Type | Notes |
|---|---|---|
| email | string | lowercase, unique |
| passwordHash | string | scrypt/argon2 |
| createdAt | number | ms |
| setupDone | boolean | first-run threshold setup finished |
Index: `by_email (email)`

### sessions [A]
| Field | Type | Notes |
|---|---|---|
| userId | Id<users> | |
| tokenHash | string | SHA-256 of random token |
| lastUsedAt | number | expiry after 30 days idle |
Index: `by_tokenHash (tokenHash)`, `by_user (userId)`

### loginAttempts [A]
| Field | Type |
|---|---|
| email | string |
| at | number |
Index: `by_email_at (email, at)`

### passwordResets [T]
| Field | Type | Notes |
|---|---|---|
| userId | Id<users> | |
| codeHash | string | |
| expiresAt | number | now + 15 min |
| tries | number | max 3 |
| used | boolean | |
Index: `by_user (userId)`

### pairingRequests [A]
| Field | Type | Notes |
|---|---|---|
| code | string | 6 chars |
| secretHash | string | from agent |
| deviceInfo | object | hostname, os, kind |
| status | "pending" \| "confirmed" \| "expired" | |
| userId | Id<users>? | set on confirm |
| deviceId | Id<devices>? | set on confirm |
| expiresAt | number | now + 10 min |
Index: `by_code (code)`

### devices [A]
| Field | Type | Notes |
|---|---|---|
| userId | Id<users> | owner |
| name | string | user-editable |
| hostname | string | |
| os | "windows" \| "linux" | |
| kind | "laptop" \| "desktop" \| "server" \| "pi" | |
| secretHash | string | SHA-256 of device secret |
| capabilities | object | see §2 |
| agentVersion | string | |
| lastSeenAt | number | updated on summary |
| online | boolean | set by cron |
| viewerUntil | number | set by app |
| pairedAt | number | |
Index: `by_user (userId)`, `by_secretHash (secretHash)`, `by_online_lastSeen (online, lastSeenAt)`

### latest [A] — one row per device, overwritten
| Field | Type |
|---|---|
| deviceId | Id<devices> |
| ts | number |
| cpu | { util, perCoreUtil[], perCoreTemp[]?, packageTemp?, clocks[], powerW? } |
| gpu | { temp, hotspot?, util, vramUsed, vramTotal, powerW, clock, fanPct }? |
| ram | { used, free, cached, total, swapUsed, swapTotal, topProcs[5] } |
| disks | [{ name, totalGB, freeGB }] |
| battery | { pct, charging, healthPct, cycles, rateW }? |
| pi | { socTemp, throttled, docker: { running, stopped, errored } }? |
Index: `by_device (deviceId)`

### summaries [A] — one row per device per minute
| Field | Type |
|---|---|
| deviceId | Id<devices> |
| minuteTs | number |
| cpuUtilAvg, cpuUtilMax | number |
| cpuTempAvg, cpuTempMax | number? |
| gpuTempMax, gpuUtilAvg | number? |
| ramPctAvg, ramPctMax | number |
| disks | [{ name, freeGB, freePct }] |
| batteryPct | number? |
| collectorStatus | { [name]: "ok" \| "degraded" \| "failed" } |
Index: `by_device_time (deviceId, minuteTs)`
Retention: **7 days** (daily cron).

### thresholds [A]
| Field | Type | Default |
|---|---|---|
| userId | Id<users> | |
| cpuTempC | number? | 90 |
| gpuTempC | number? | 85 |
| ramPct | number? | 90 |
Unset field → default. Index: `by_user (userId)`

### diskThresholds [A]
| Field | Type | Notes |
|---|---|---|
| deviceId | Id<devices> | |
| drive | string | e.g. `C:`, `/` |
| minFreePct | number? | default 10 |
| minFreeGB | number? | optional |
Index: `by_device (deviceId)`

### alerts [A]
| Field | Type |
|---|---|
| userId | Id<users> |
| deviceId | Id<devices> |
| type | "cpuTemp" \| "gpuTemp" \| "ram" \| "disk" \| "offline" \| "canary" |
| value | number? |
| threshold | number? |
| createdAt | number |
| pushed | boolean |
Index: `by_user_time (userId, createdAt)`, `by_device_type_time (deviceId, type, createdAt)` (for cooldown)
Cooldown: new alert skipped if same `deviceId` + `type` exists within last **15 min**.

### pushTokens [T]
| Field | Type |
|---|---|
| userId | Id<users> |
| fcmToken | string |
| phoneModel | string |
| updatedAt | number |
Index: `by_user (userId)`, `by_token (fcmToken)`

### canary [A writes send, T writes ack]
| Field | Type |
|---|---|
| userId | Id<users> |
| sentAt | number |
| ackedAt | number? |
Index: `by_user (userId)`

---

## 2. Capabilities object

```ts
{
  hasBattery: boolean,
  hasNvidiaGpu: boolean,
  perCoreTemps: boolean,
  windowsMode?: "full" | "noDriver",
  isPi: boolean,
  drives: { name: string, totalGB: number }[]
}
```

---

## 3. Size and quota estimates (4 devices)

| Table | Rows | Size |
|---|---|---|
| summaries | 4 × 1,440 × 7 ≈ 40k | ~25 MB |
| latest | 4 | tiny |
| alerts | depends on cooldown | small |
| others | < 100 | tiny |

| Item | Calls / month |
|---|---|
| Summaries | ~173k |
| Offline cron | ~43k |
| Live viewing | 7,440 per viewing-hour |
| Project cap (80 % of 6M) | 4.8M → ~615 viewing-hours |

---

## 4. Schema sketch (`convex/schema.ts`)

```ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  devices: defineTable({
    userId: v.id("users"),
    name: v.string(),
    hostname: v.string(),
    os: v.union(v.literal("windows"), v.literal("linux")),
    kind: v.union(v.literal("laptop"), v.literal("desktop"), v.literal("server"), v.literal("pi")),
    secretHash: v.string(),
    capabilities: v.any(),        // tighten after week 2
    agentVersion: v.string(),
    lastSeenAt: v.number(),
    online: v.boolean(),
    viewerUntil: v.number(),
    pairedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_secretHash", ["secretHash"])
    .index("by_online_lastSeen", ["online", "lastSeenAt"]),
  // ... other tables as above
});
```
Full schema written in week 2 (both).

---

## 5. Deployment

Single **prod** deployment only. Fake/seed data must set `isFake: true` on devices and be deleted before week 3.
