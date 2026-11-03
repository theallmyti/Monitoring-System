// Read-only view for the personal dashboard (dashboard/ folder).
// Auth: a read token (env var DASHBOARD_READ_TOKEN). Only the owner has it.
// Replaced by real sign-in in week 2 (docs/Flow.md §1, docs/Security.md §4).
import { query } from "./_generated/server";
import { v, ConvexError } from "convex/values";

// A device is online while its last summary/push is recent (docs/Architecture.md §2.2, FR-44).
const OFFLINE_AFTER_MS = 3 * 60 * 1000;

export const overview = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const expected = process.env.DASHBOARD_READ_TOKEN;
    if (!expected || args.token !== expected) {
      throw new ConvexError("not authorized");
    }
    const now = Date.now();
    const devices = await ctx.db.query("devices").collect();
    const out = [];
    for (const d of devices) {
      const latest = await ctx.db
        .query("latest")
        .withIndex("by_device", (q) => q.eq("deviceId", d._id))
        .unique();
      // Live pushes do not touch lastSeenAt, so "seen" is the newest push time.
      const seen = latest ? latest.ts : d.lastSeenAt;
      out.push({
        id: d._id,
        name: d.name,
        lastSeenAt: seen,
        online: now - seen < OFFLINE_AFTER_MS,
        latest: latest ?? null,
      });
    }
    return { now, devices: out };
  },
});

// Per-minute history for one device since `sinceMs` (oldest first). Max ~1440 rows for 24 h.
export const history = query({
  args: { token: v.string(), deviceId: v.id("devices"), sinceMs: v.number() },
  handler: async (ctx, args) => {
    const expected = process.env.DASHBOARD_READ_TOKEN;
    if (!expected || args.token !== expected) {
      throw new ConvexError("not authorized");
    }
    return await ctx.db
      .query("summaries")
      .withIndex("by_device_time", (q) => q.eq("deviceId", args.deviceId).gte("minuteTs", args.sinceMs))
      .collect();
  },
});
