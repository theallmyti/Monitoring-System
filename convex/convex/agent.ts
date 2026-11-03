// Agent endpoints (docs/Architecture.md §3.1, owner: Aditya).
// Auth: the agent sends SHA-256(device secret); Convex only stores and compares the hash
// (docs/Flow.md §3, docs/Security.md §6). Pairing (week 2) will link devices to users;
// until then `register` is open, so treat devices created now as test data (isFake: true).
import { mutation, query, MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";

async function deviceBySecretHash(ctx: MutationCtx, secretHash: string) {
  return await ctx.db
    .query("devices")
    .withIndex("by_secretHash", (q) => q.eq("secretHash", secretHash))
    .unique();
}

export const register = mutation({
  args: { secretHash: v.string(), name: v.string() },
  handler: async (ctx, args) => {
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
  },
  handler: async (ctx, args) => {
    // FR-28: reject impossible values.
    if (args.cpuUtil < 0 || args.cpuUtil > 100 || args.ramUsedPct < 0 || args.ramUsedPct > 100) {
      throw new ConvexError("value out of range");
    }
    const device = await deviceBySecretHash(ctx, args.secretHash);
    if (!device) {
      throw new ConvexError("unknown device");
    }
    await ctx.db.patch(device._id, { lastSeenAt: args.ts });
    const row = {
      deviceId: device._id,
      ts: args.ts,
      cpu: { util: args.cpuUtil },
      ram: { usedPct: args.ramUsedPct },
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

export const getLatest = query({
  args: { deviceId: v.id("devices") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("latest")
      .withIndex("by_device", (q) => q.eq("deviceId", args.deviceId))
      .unique();
  },
});
