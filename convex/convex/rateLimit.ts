// Fixed-window rate limits stored in the `rateEvents` table (docs/Security.md §2).
// Convex functions do not see the caller's IP address, so limits are per account, per device,
// or global. Old events are deleted by the daily cleanup (cleanup.ts).
import type { MutationCtx, QueryCtx } from "./_generated/server";

export type Limit = { max: number; windowMs: number };

export const LIMITS = {
  // New accounts, all callers together: stops a script creating thousands of accounts.
  signup: { max: 10, windowMs: 60 * 60 * 1000 },
  // Pairing codes per device (a normal install needs one every 10 minutes at most) ...
  pairPerDevice: { max: 5, windowMs: 10 * 60 * 1000 },
  // ... and for all devices together, so random device keys cannot flood the table.
  pairGlobal: { max: 60, windowMs: 10 * 60 * 1000 },
  // Wrong pairing codes per account: stops guessing someone else's open code.
  wrongCode: { max: 10, windowMs: 10 * 60 * 1000 },
} satisfies Record<string, Limit>;

export async function isLimited(ctx: QueryCtx, key: string, limit: Limit) {
  const since = Date.now() - limit.windowMs;
  const recent = await ctx.db
    .query("rateEvents")
    .withIndex("by_key_at", (q) => q.eq("key", key).gt("at", since))
    .take(limit.max);
  return recent.length >= limit.max;
}

export async function recordEvent(ctx: MutationCtx, key: string) {
  await ctx.db.insert("rateEvents", { key, at: Date.now() });
}
