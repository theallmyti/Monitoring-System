// Migration to accounts (docs/Database.md, docs/Development.md §3).
//
// Devices paired before accounts existed have no owner (`userId` unset). Nobody can see them, and
// they become someone's again only when that computer is paired again. Steps:
//   1. expand (done): `devices.userId` is optional; pairing sets it; old devices keep working.
//   2. claim: owners pair their computers again (the installer or `pc-monitor-agent pair`).
//   3. contract: remove what is left. Review first, then run:
//        npx convex run --prod migrations:listOwnerless
//        npx convex run --prod migrations:removeOwnerless '{"notSeenForDays": 0, "dryRun": true}'
//      The daily cron removes ownerless devices not seen for 30 days on its own.
//   4. when no agent calls `agent:register` any more (its log line stops), delete it and the
//      AGENT_REGISTRATION_SECRET env var.
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { removeDeviceData } from "./model";

const DAY_MS = 24 * 60 * 60 * 1000;
export const OWNERLESS_MAX_IDLE_DAYS = 30;

export const listOwnerless = internalQuery({
  args: {},
  handler: async (ctx) => {
    const devices = await ctx.db
      .query("devices")
      .withIndex("by_user", (q) => q.eq("userId", undefined))
      .collect();
    return devices.map((d) => ({
      id: d._id,
      name: d.name,
      lastSeen: new Date(d.lastSeenAt).toISOString(),
      agentVersion: d.agentVersion ?? "unknown",
      isFake: d.isFake,
    }));
  },
});

async function idleOwnerless(ctx: MutationCtx, notSeenForDays: number) {
  const cutoff = Date.now() - notSeenForDays * DAY_MS;
  const devices = await ctx.db
    .query("devices")
    .withIndex("by_user", (q) => q.eq("userId", undefined))
    .collect();
  return devices.filter((d) => d.lastSeenAt <= cutoff);
}

// Removes ownerless devices not seen for `notSeenForDays` days, with their history.
// dryRun: only list what would be removed.
export const removeOwnerless = internalMutation({
  args: { notSeenForDays: v.number(), dryRun: v.boolean() },
  handler: async (ctx, args) => {
    const stale = await idleOwnerless(ctx, args.notSeenForDays);
    const names = stale.map((d) => d.name);
    if (args.dryRun) {
      return { removed: [], wouldRemove: names };
    }
    for (const d of stale) {
      await removeDeviceData(ctx, d);
    }
    return { removed: names, wouldRemove: [] };
  },
});

// Daily (crons.ts): ownerless devices idle for 30 days. An agent that is still running keeps its
// device until the owner pairs it again.
export const removeIdleOwnerless = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stale = await idleOwnerless(ctx, OWNERLESS_MAX_IDLE_DAYS);
    for (const d of stale) {
      await removeDeviceData(ctx, d);
    }
    return stale.length;
  },
});
