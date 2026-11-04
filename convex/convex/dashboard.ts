// Endpoints for the site (and the app): every call needs a signed-in session and only ever
// touches the caller's own devices (docs/Security.md §2, FR-13, FR-14, T-12).
import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import {
  deviceBySecretHash,
  ownedDevice,
  pairingByCode,
  pairingState,
  removeDeviceData,
  requireUser,
  requireUserAndTouch,
} from "./model";

// Offline when no summary for 3 minutes (FR-44). Summaries arrive every 60 s.
const OFFLINE_AFTER_MS = 3 * 60 * 1000;
// FR-33: the viewer sets now + 30 s and repeats every 15 s while a screen is open.
const VIEWER_WINDOW_MS = 30 * 1000;

export const overview = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const now = Date.now();
    const devices = await ctx.db
      .query("devices")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
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
    const user = await requireUser(ctx, args.token);
    await ownedDevice(ctx, user, args.deviceId);
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
    const user = await requireUserAndTouch(ctx, args.token);
    await ownedDevice(ctx, user, args.deviceId);
    await ctx.db.patch(args.deviceId, { viewerUntil: Date.now() + VIEWER_WINDOW_MS });
  },
});

// FR-14: rename a device.
export const renameDevice = mutation({
  args: { token: v.string(), deviceId: v.id("devices"), name: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUserAndTouch(ctx, args.token);
    await ownedDevice(ctx, user, args.deviceId);
    const name = args.name.trim();
    if (name.length < 1 || name.length > 64) {
      throw new ConvexError("Use 1 to 64 characters for the name.");
    }
    await ctx.db.patch(args.deviceId, { name });
  },
});

// FR-14: remove a device. Its secret hash is deleted, so that computer can no longer write.
export const removeDevice = mutation({
  args: { token: v.string(), deviceId: v.id("devices") },
  handler: async (ctx, args) => {
    const user = await requireUserAndTouch(ctx, args.token);
    const device = await ownedDevice(ctx, user, args.deviceId);
    await removeDeviceData(ctx, device);
  },
});

// Pairing: show which computer is asking before confirming (docs/Security.md §2).
export const pairingInfo = query({
  args: { token: v.string(), code: v.string() },
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token);
    const r = await pairingByCode(ctx, args.code);
    if (!r) {
      return null;
    }
    return { name: r.name, os: r.os, state: pairingState(r, Date.now()) };
  },
});

// The signed-in user who confirms becomes the device's owner (FR-11). A computer that is
// paired again (new owner, or a device from before accounts) moves to the confirming user.
export const confirmPairing = mutation({
  args: { token: v.string(), code: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUserAndTouch(ctx, args.token);
    const r = await pairingByCode(ctx, args.code);
    if (!r || pairingState(r, Date.now()) !== "pending") {
      throw new ConvexError("code not found or expired");
    }
    const now = Date.now();
    const existing = await deviceBySecretHash(ctx, r.secretHash);
    let deviceId;
    if (existing) {
      await ctx.db.patch(existing._id, { userId: user._id, isFake: false });
      deviceId = existing._id;
    } else {
      deviceId = await ctx.db.insert("devices", {
        userId: user._id,
        name: r.name,
        secretHash: r.secretHash,
        lastSeenAt: now,
        isFake: false,
      });
    }
    await ctx.db.patch(r._id, { status: "confirmed", deviceId });
    return { deviceId, name: r.name };
  },
});
