// Agent endpoints (docs/Architecture.md §3.1, owner: Aditya).
// Auth:
//  - register: needs the team registration secret (env var AGENT_REGISTRATION_SECRET).
//    Only the two of us know it. Replaced by pairing in week 2 (docs/Flow.md §3).
//  - pushLatest: the agent sends SHA-256(device secret); Convex compares the hash
//    (docs/Flow.md §3, docs/Security.md §6).
// No public read endpoint: the app reads through pairing in week 2.
import { mutation, MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";

async function deviceBySecretHash(ctx: MutationCtx, secretHash: string) {
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
  },
  handler: async (ctx, args) => {
    const expected = process.env.AGENT_REGISTRATION_SECRET;
    if (!expected || args.registrationSecret !== expected) {
      throw new ConvexError("not authorized");
    }
    const now = Date.now();
    const existing = await deviceBySecretHash(ctx, args.secretHash);
    if (existing) {
      await ctx.db.patch(existing._id, { name: args.name, lastSeenAt: now });
      return existing._id;
    }
    return await ctx.db.insert("devices", {
      name: args.name,
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
    const device = await deviceBySecretHash(ctx, args.secretHash);
    if (!device) {
      throw new ConvexError("unknown device");
    }
    // lastSeenAt is set by summaries only (Architecture.md §2.2), not per live push.
    const row = {
      deviceId: device._id,
      ts: args.ts,
      cpu: { util: args.cpuUtil, packageTemp: args.cpuTemp },
      ram: { usedPct: args.ramUsedPct },
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
