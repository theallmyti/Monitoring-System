// Personal dashboard endpoints (dashboard/ folder).
// Auth: a read token (env var DASHBOARD_READ_TOKEN). Only the owner has it.
// Replaced by real sign-in in Task 8 (docs/Flow.md §1, docs/Security.md §4).
import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";

// Offline when no summary for 3 minutes (FR-44). Summaries arrive every 60 s.
const OFFLINE_AFTER_MS = 3 * 60 * 1000;
// FR-33: the viewer sets now + 30 s and repeats every 15 s while a screen is open.
const VIEWER_WINDOW_MS = 30 * 1000;

function requireToken(token: string) {
  const expected = process.env.DASHBOARD_READ_TOKEN;
  if (!expected || token !== expected) {
    throw new ConvexError("not authorized");
  }
}

export const overview = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    requireToken(args.token);
    const now = Date.now();
    const devices = await ctx.db.query("devices").collect();
    const out = [];
    for (const d of devices) {
      const latest = await ctx.db
        .query("latest")
        .withIndex("by_device", (q) => q.eq("deviceId", d._id))
        .unique();
      out.push({
        id: d._id,
        name: d.name,
        lastSeenAt: d.lastSeenAt,
        online: now - d.lastSeenAt < OFFLINE_AFTER_MS,
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
    requireToken(args.token);
    return await ctx.db
      .query("summaries")
      .withIndex("by_device_time", (q) => q.eq("deviceId", args.deviceId).gte("minuteTs", args.sinceMs))
      .collect();
  },
});

// Keep live data flowing for this device for the next 30 s (docs/Flow.md §4).
export const setViewer = mutation({
  args: { token: v.string(), deviceId: v.id("devices") },
  handler: async (ctx, args) => {
    requireToken(args.token);
    const device = await ctx.db.get(args.deviceId);
    if (!device) {
      throw new ConvexError("unknown device");
    }
    await ctx.db.patch(args.deviceId, { viewerUntil: Date.now() + VIEWER_WINDOW_MS });
  },
});
