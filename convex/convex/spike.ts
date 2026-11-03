// S4 spike: overwrite one "latest" row per device (docs/Database.md, decision D4).
// No auth yet: device-secret checks come in week 2 (docs/Security.md).
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const pushLatest = mutation({
  args: {
    deviceName: v.string(),
    ts: v.number(),
    cpuUtil: v.number(),
    ramUsedPct: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("spikeLatest")
      .withIndex("by_device", (q) => q.eq("deviceName", args.deviceName))
      .unique();
    const row = { ...args, isFake: true };
    if (existing) {
      await ctx.db.replace(existing._id, row);
    } else {
      await ctx.db.insert("spikeLatest", row);
    }
  },
});

export const getLatest = query({
  args: { deviceName: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("spikeLatest")
      .withIndex("by_device", (q) => q.eq("deviceName", args.deviceName))
      .unique();
  },
});
