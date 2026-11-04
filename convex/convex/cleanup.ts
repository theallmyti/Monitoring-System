// Daily cleanup of short-lived rows (cron in crons.ts), batched like summaries.deleteOld:
// - rate-limit events and failed sign-ins older than a day (limits look back 1 hour at most)
// - pairing codes that expired over an hour ago (the agent stops watching once a code expires)
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const BATCH = 500;

export const deleteExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const events = await ctx.db
      .query("rateEvents")
      .withIndex("by_at", (q) => q.lt("at", now - DAY_MS))
      .take(BATCH);
    const attempts = await ctx.db
      .query("loginAttempts")
      .withIndex("by_at", (q) => q.lt("at", now - DAY_MS))
      .take(BATCH);
    const codes = await ctx.db
      .query("pairingRequests")
      .withIndex("by_expires", (q) => q.lt("expiresAt", now - HOUR_MS))
      .take(BATCH);
    for (const row of [...events, ...attempts, ...codes]) {
      await ctx.db.delete(row._id);
    }
    // A full batch means more may remain: run again straight away.
    if ([events, attempts, codes].some((rows) => rows.length === BATCH)) {
      await ctx.scheduler.runAfter(0, internal.cleanup.deleteExpired, {});
    }
    return { events: events.length, attempts: attempts.length, codes: codes.length };
  },
});
