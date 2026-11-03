// History retention (FR-50, docs/Flow.md §8): delete summaries older than 7 days,
// in batches so one run stays inside Convex function limits.
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH = 500;

export const deleteOld = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - RETENTION_MS;
    const old = await ctx.db
      .query("summaries")
      .withIndex("by_minute", (q) => q.lt("minuteTs", cutoff))
      .take(BATCH);
    for (const row of old) {
      await ctx.db.delete(row._id);
    }
    // A full batch means more may remain: run again straight away.
    if (old.length === BATCH) {
      await ctx.scheduler.runAfter(0, internal.summaries.deleteOld, {});
    }
    return old.length;
  },
});

// All history of one device, after it is removed (uninstall). Batched like deleteOld.
export const deleteForDevice = internalMutation({
  args: { deviceId: v.id("devices") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("summaries")
      .withIndex("by_device_time", (q) => q.eq("deviceId", args.deviceId))
      .take(BATCH);
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    if (rows.length === BATCH) {
      await ctx.scheduler.runAfter(0, internal.summaries.deleteForDevice, args);
    }
    return rows.length;
  },
});
