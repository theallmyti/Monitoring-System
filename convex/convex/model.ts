// Lookups and rules shared by several modules.
import { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { ConvexError } from "convex/values";
import { tokenHash } from "./passwords";

export async function deviceBySecretHash(ctx: Pick<QueryCtx, "db">, secretHash: string) {
  return await ctx.db
    .query("devices")
    .withIndex("by_secretHash", (q) => q.eq("secretHash", secretHash))
    .unique();
}

// Codes are typed or scanned in upper case without spaces; accept "abc 123" too.
export function normalizeCode(code: string) {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

export async function pairingByCode(ctx: Pick<QueryCtx, "db">, code: string) {
  return await ctx.db
    .query("pairingRequests")
    .withIndex("by_code", (q) => q.eq("code", normalizeCode(code)))
    .unique();
}

export type PairingState = "pending" | "confirmed" | "expired";

export function pairingState(r: { status: string; expiresAt: number }, now: number): PairingState {
  if (r.status === "confirmed") return "confirmed";
  return now > r.expiresAt ? "expired" : "pending";
}

// --- Sessions (docs/Security.md §4) ---

// FR-02: a session expires after 30 days without use; each use renews it.
export const SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
// Renew at most once an hour, so reads do not turn into a write per request.
const TOUCH_EVERY_MS = 60 * 60 * 1000;

export async function sessionUser(ctx: Pick<QueryCtx, "db">, token: string) {
  if (!token) return null;
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash(token)))
    .unique();
  if (!session || Date.now() - session.lastUsedAt > SESSION_IDLE_MS) return null;
  const user = await ctx.db.get(session.userId);
  return user ? { user, session } : null;
}

export async function requireUser(ctx: Pick<QueryCtx, "db">, token: string) {
  const found = await sessionUser(ctx, token);
  if (!found) throw new ConvexError("signed out");
  return found.user;
}

// In mutations: also renew the session (sliding 30 days).
export async function requireUserAndTouch(ctx: MutationCtx, token: string) {
  const found = await sessionUser(ctx, token);
  if (!found) throw new ConvexError("signed out");
  if (Date.now() - found.session.lastUsedAt > TOUCH_EVERY_MS) {
    await ctx.db.patch(found.session._id, { lastUsedAt: Date.now() });
  }
  return found.user;
}

// Every device read or change goes through this (docs/Security.md §2, test T-12).
// A device owned by someone else looks exactly like a missing one.
export async function ownedDevice(
  ctx: Pick<QueryCtx, "db">,
  user: Doc<"users">,
  deviceId: Id<"devices">,
) {
  const device = await ctx.db.get(deviceId);
  if (!device || device.userId !== user._id) throw new ConvexError("device not found");
  return device;
}

// Remove a device with its live row and pairing codes; history is deleted in batches.
export async function removeDeviceData(ctx: MutationCtx, device: Doc<"devices">) {
  for (const row of await ctx.db
    .query("latest")
    .withIndex("by_device", (q) => q.eq("deviceId", device._id))
    .collect()) {
    await ctx.db.delete(row._id);
  }
  for (const r of await ctx.db
    .query("pairingRequests")
    .withIndex("by_secretHash", (q) => q.eq("secretHash", device.secretHash))
    .collect()) {
    await ctx.db.delete(r._id);
  }
  await ctx.db.delete(device._id);
  await ctx.scheduler.runAfter(0, internal.summaries.deleteForDevice, { deviceId: device._id });
}
