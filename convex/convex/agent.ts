// Agent endpoints (docs/Architecture.md §3.1, owner: Aditya).
// Auth:
//  - register: needs the team registration secret (env var AGENT_REGISTRATION_SECRET).
//    Only the two of us know it. Replaced by pairing in week 2 (docs/Flow.md §3).
//  - pushLatest, pushSummary, watchViewer: the agent sends SHA-256(device secret);
//    Convex compares the hash (docs/Flow.md §3, docs/Security.md §6).
// No public read endpoint: the app reads through pairing in week 2.
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { deviceBySecretHash, removeDeviceData } from "./model";
import { LATEST_AGENT_VERSION, isUnsupported } from "./versions";
import { RETENTION_MS } from "./summaries";
import { v, ConvexError, type Infer } from "convex/values";
import { battery, capabilities, driveLive, driveSummary, ramDetail, topProc } from "./validators";

// docs/Security.md §2: at most one summary per 50 s per device.
const SUMMARY_MIN_GAP_MS = 50_000;


// Called at every agent start once the device is paired: refreshes what it reports (FR-15).
// Never creates a device; pairing does that.
export const hello = mutation({
  args: {
    secretHash: v.string(),
    capabilities: v.optional(capabilities),
    agentVersion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (isUnsupported(args.agentVersion)) {
      throw new ConvexError(
        `This agent (${args.agentVersion}) is too old. Install version ${LATEST_AGENT_VERSION} from PC Monitor's releases.`,
      );
    }
    const device = await deviceBySecretHash(ctx, args.secretHash);
    if (!device) {
      throw new ConvexError("not paired");
    }
    await ctx.db.patch(device._id, {
      capabilities: args.capabilities,
      agentVersion: args.agentVersion,
      lastSeenAt: Date.now(),
    });
    // owned = linked to an account. Devices paired before accounts existed have no owner and
    // are shown to nobody until they are paired again (docs/Security.md §2).
    // latestVersion: the agent logs when a newer release exists (versions.ts).
    return { deviceId: device._id, owned: device.userId !== undefined, latestVersion: LATEST_AGENT_VERSION };
  },
});

// Uninstall: the agent removes its own device, live row, pairing codes and history.
// Authenticated by the device secret hash; unknown devices are a no-op (already removed).
export const unpair = mutation({
  args: { secretHash: v.string() },
  handler: async (ctx, args) => {
    const device = await deviceBySecretHash(ctx, args.secretHash);
    if (!device) {
      return false;
    }
    await removeDeviceData(ctx, device);
    return true;
  },
});

// Legacy: registration with the team secret, kept until every agent uses pairing (Task 8).
export const register = mutation({
  args: {
    registrationSecret: v.string(),
    secretHash: v.string(),
    name: v.string(),
    capabilities: v.optional(capabilities),
    agentVersion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const expected = process.env.AGENT_REGISTRATION_SECRET;
    if (!expected || args.registrationSecret !== expected) {
      throw new ConvexError("not authorized");
    }
    // Shows in the Convex logs; when this stops appearing, register can be deleted (migrations.ts).
    console.warn(`legacy agent:register used by "${args.name}" (agent ${args.agentVersion ?? "unknown"})`);
    const now = Date.now();
    const report = { name: args.name, capabilities: args.capabilities, agentVersion: args.agentVersion };
    const existing = await deviceBySecretHash(ctx, args.secretHash);
    if (existing) {
      await ctx.db.patch(existing._id, { ...report, lastSeenAt: now });
      return existing._id;
    }
    return await ctx.db.insert("devices", {
      ...report,
      secretHash: args.secretHash,
      lastSeenAt: now,
      isFake: true,
    });
  },
});

export const pushLatest = mutation({
  args: {
    secretHash: v.string(),
    ts: v.number(),
    cpuUtil: v.number(),
    ramUsedPct: v.number(),
    cpuTemp: v.optional(v.number()),
    docker: v.optional(v.object({ running: v.number(), stopped: v.number(), errored: v.number() })),
    perCoreUtil: v.optional(v.array(v.number())),
    clocks: v.optional(v.array(v.number())),
    ram: v.optional(ramDetail),
    topProcs: v.optional(v.array(topProc)),
    disks: v.optional(v.array(driveLive)),
    uptimeSec: v.optional(v.number()),
    battery: v.optional(battery),
    gpu: v.optional(
      v.object({
        temp: v.number(),
        util: v.number(),
        vramUsed: v.number(),
        vramTotal: v.number(),
        powerW: v.number(),
        clock: v.number(),
        fanPct: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    // FR-28: reject impossible values.
    if (args.cpuUtil < 0 || args.cpuUtil > 100 || args.ramUsedPct < 0 || args.ramUsedPct > 100) {
      throw new ConvexError("value out of range");
    }
    if (args.cpuTemp !== undefined && (args.cpuTemp < 0 || args.cpuTemp > 125)) {
      throw new ConvexError("cpu temp out of range");
    }
    if (args.gpu && (args.gpu.temp < 0 || args.gpu.temp > 125 || args.gpu.util < 0 || args.gpu.util > 100)) {
      throw new ConvexError("gpu value out of range");
    }
    if (args.perCoreUtil?.some((p) => p < 0 || p > 100)) {
      throw new ConvexError("per-core value out of range");
    }
    if (args.disks?.some((d) => d.freeGB < 0 || d.freeGB > d.totalGB)) {
      throw new ConvexError("disk value out of range");
    }
    if (args.battery && (args.battery.pct < 0 || args.battery.pct > 100)) {
      throw new ConvexError("battery value out of range");
    }
    const device = await deviceBySecretHash(ctx, args.secretHash);
    if (!device) {
      throw new ConvexError("unknown device");
    }
    // lastSeenAt is set by summaries only (Architecture.md §2.2), not per live push.
    const row = {
      deviceId: device._id,
      ts: args.ts,
      cpu: { util: args.cpuUtil, packageTemp: args.cpuTemp, perCoreUtil: args.perCoreUtil, clocks: args.clocks },
      ram: { usedPct: args.ramUsedPct, detail: args.ram, topProcs: args.topProcs },
      disks: args.disks,
      uptimeSec: args.uptimeSec,
      battery: args.battery,
      gpu: args.gpu,
      pi: args.docker ? { docker: args.docker } : undefined,
    };
    const existing = await ctx.db
      .query("latest")
      .withIndex("by_device", (q) => q.eq("deviceId", device._id))
      .unique();
    if (existing) {
      await ctx.db.replace(existing._id, row);
    } else {
      await ctx.db.insert("latest", row);
    }
  },
});

const MINUTE_MS = 60_000;

// The minute a summary belongs to, by the server's clock: a PC with a wrong clock must not put
// its history in the wrong place, or out of reach of the 7-day cleanup (docs/Security.md §2).
export function serverMinute(now: number) {
  return Math.floor(now / MINUTE_MS) * MINUTE_MS;
}

const summaryFields = {
  cpuUtilAvg: v.number(),
  cpuUtilMax: v.number(),
  ramPctAvg: v.number(),
  ramPctMax: v.number(),
  cpuTempAvg: v.optional(v.number()),
  cpuTempMax: v.optional(v.number()),
  gpuTempMax: v.optional(v.number()),
  gpuUtilAvg: v.optional(v.number()),
  disks: v.optional(v.array(driveSummary)),
  batteryPct: v.optional(v.number()),
};
const summaryValidator = v.object(summaryFields);
type SummaryFields = Infer<typeof summaryValidator>;

// FR-28: reject impossible values.
function checkSummary(summary: SummaryFields) {
  if (summary.disks?.some((d) => d.freeGB < 0 || d.freePct < 0 || d.freePct > 100)) {
    throw new ConvexError("disk value out of range");
  }
  const percents = [
    summary.cpuUtilAvg,
    summary.cpuUtilMax,
    summary.ramPctAvg,
    summary.ramPctMax,
    summary.gpuUtilAvg,
    summary.batteryPct,
  ];
  const temps = [summary.cpuTempAvg, summary.cpuTempMax, summary.gpuTempMax];
  if (
    percents.some((p) => p !== undefined && (p < 0 || p > 100)) ||
    temps.some((t) => t !== undefined && (t < 0 || t > 125))
  ) {
    throw new ConvexError("value out of range");
  }
}

// One row per device and minute: a second summary for the same minute replaces the first, so a
// retried send never makes a duplicate (idempotent).
async function storeSummary(ctx: MutationCtx, deviceId: Id<"devices">, minuteTs: number, summary: SummaryFields) {
  const existing = await ctx.db
    .query("summaries")
    .withIndex("by_device_time", (q) => q.eq("deviceId", deviceId).eq("minuteTs", minuteTs))
    .first();
  if (existing) {
    await ctx.db.replace(existing._id, { deviceId, minuteTs, ...summary });
  } else {
    await ctx.db.insert("summaries", { deviceId, minuteTs, ...summary });
  }
}

// Every 60 s, always: the minute's averages and peaks (docs/Architecture.md §2.2, FR-30).
// `minuteTs` from the agent is ignored (its clock may be wrong); kept so older agents still work.
export const pushSummary = mutation({
  args: { secretHash: v.string(), minuteTs: v.number(), ...summaryFields },
  handler: async (ctx, { secretHash, minuteTs: _agentMinute, ...summary }) => {
    checkSummary(summary);
    const device = await deviceBySecretHash(ctx, secretHash);
    if (!device) {
      throw new ConvexError("unknown device");
    }
    const now = Date.now();
    if (device.lastSummaryAt !== undefined && now - device.lastSummaryAt < SUMMARY_MIN_GAP_MS) {
      throw new ConvexError("summary sent too soon");
    }
    await storeSummary(ctx, device._id, serverMinute(now), summary);
    await ctx.db.patch(device._id, { lastSeenAt: now, lastSummaryAt: now });
  },
});

// Agents from 0.2.0: the summaries not sent yet, oldest first, in one call per minute. While a
// computer is offline the agent keeps them (up to a day) and sends the backlog when it is back.
// Times: the agent stamps each minute with its own clock and sends `sentAt` (its clock now); the
// server shifts every minute by (server now - sentAt), so a wrong PC clock does not matter.
// Rows that are impossible, in the future or older than the 7-day retention are skipped (counted)
// instead of failing the batch, so one bad row cannot block the backlog. A minute that is already
// stored is replaced, so a retried batch never makes duplicates.
const MAX_BATCH = 60;

export const pushSummaries = mutation({
  args: {
    secretHash: v.string(),
    sentAt: v.number(),
    summaries: v.array(v.object({ minuteTs: v.number(), ...summaryFields })),
  },
  handler: async (ctx, args) => {
    if (args.summaries.length === 0 || args.summaries.length > MAX_BATCH) {
      throw new ConvexError(`send 1 to ${MAX_BATCH} summaries per call`);
    }
    const device = await deviceBySecretHash(ctx, args.secretHash);
    if (!device) {
      throw new ConvexError("unknown device");
    }
    const now = Date.now();
    // docs/Security.md §2: one call per 50 s. Not an error: the agent keeps the batch and retries.
    if (device.lastSummaryAt !== undefined && now - device.lastSummaryAt < SUMMARY_MIN_GAP_MS) {
      return { stored: 0, skipped: 0, tooSoon: true };
    }
    const offset = now - args.sentAt;
    const newest = serverMinute(now);
    const oldest = now - RETENTION_MS;
    let stored = 0;
    let skipped = 0;
    for (const { minuteTs, ...summary } of args.summaries) {
      const minute = serverMinute(minuteTs + offset);
      try {
        checkSummary(summary);
      } catch {
        skipped++;
        continue;
      }
      if (minute > newest || minute < oldest) {
        skipped++;
        continue;
      }
      await storeSummary(ctx, device._id, minute, summary);
      stored++;
    }
    await ctx.db.patch(device._id, { lastSeenAt: now, lastSummaryAt: now });
    return { stored, skipped, tooSoon: false };
  },
});

// The agent subscribes to this; live pushes run only while the value is in the future (FR-31).
export const watchViewer = query({
  args: { secretHash: v.string() },
  handler: async (ctx, args) => {
    const device = await deviceBySecretHash(ctx, args.secretHash);
    if (!device) {
      throw new ConvexError("unknown device");
    }
    return device.viewerUntil ?? 0;
  },
});
