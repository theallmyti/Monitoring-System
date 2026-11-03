// Lookups shared by several modules.
import { QueryCtx } from "./_generated/server";

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
