// Agent endpoints (docs/Architecture.md §3.1, owner: Aditya).
// Auth:
//  - register: needs the team registration secret (env var AGENT_REGISTRATION_SECRET).
//    Only the two of us know it. Replaced by pairing in week 2 (docs/Flow.md §3).
//  - pushLatest, pushSummary, watchViewer: the agent sends SHA-256(device secret);
//    Convex compares the hash (docs/Flow.md §3, docs/Security.md §6).
// No public read endpoint: the app reads through pairing in week 2.
import { mutation, query, QueryCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { capabilities, driveLive, driveSummary, ramDetail, topProc } from "./validators";

// docs/Security.md §2: at most one summary per 50 s per device.
const SUMMARY_MIN_GAP_MS = 50_000;

async function deviceBySecretHash(ctx: Pick<QueryCtx, "db">, secretHash: string) {
  return await ctx.db
    .query("devices")
    .withIndex("by_secretHash", (q) => q.eq("secretHash", secretHash))
    .unique();
}

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

// Every 60 s, always: the minute's averages and peaks (docs/Architecture.md §2.2, FR-30).
export const pushSummary = mutation({
  args: {
    secretHash: v.string(),
    minuteTs: v.number(),
    cpuUtilAvg: v.number(),
    cpuUtilMax: v.number(),
    ramPctAvg: v.number(),
    ramPctMax: v.number(),
    cpuTempAvg: v.optional(v.number()),
    cpuTempMax: v.optional(v.number()),
    gpuTempMax: v.optional(v.number()),
    gpuUtilAvg: v.optional(v.number()),
    disks: v.optional(v.array(driveSummary)),
  },
  handler: async (ctx, { secretHash, ...summary }) => {
    if (summary.disks?.some((d) => d.freeGB < 0 || d.freePct < 0 || d.freePct > 100)) {
      throw new ConvexError("disk value out of range");
    }
    // FR-28: reject impossible values.
    const percents = [summary.cpuUtilAvg, summary.cpuUtilMax, summary.ramPctAvg, summary.ramPctMax, summary.gpuUtilAvg];
    const temps = [summary.cpuTempAvg, summary.cpuTempMax, summary.gpuTempMax];
    if (
      percents.some((p) => p !== undefined && (p < 0 || p > 100)) ||
      temps.some((t) => t !== undefined && (t < 0 || t > 125))
    ) {
      throw new ConvexError("value out of range");
    }
    const device = await deviceBySecretHash(ctx, secretHash);
    if (!device) {
      throw new ConvexError("unknown device");
    }
    const now = Date.now();
    if (device.lastSummaryAt !== undefined && now - device.lastSummaryAt < SUMMARY_MIN_GAP_MS) {
      throw new ConvexError("summary sent too soon");
    }
    await ctx.db.insert("summaries", { deviceId: device._id, ...summary });
    await ctx.db.patch(device._id, { lastSeenAt: now, lastSummaryAt: now });
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
