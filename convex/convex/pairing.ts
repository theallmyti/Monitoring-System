// Device pairing, agent side (docs/Flow.md §3, FR-10–FR-12).
// The agent sends SHA-256 of its device secret plus its name; Convex returns a 6-character code
// valid for 10 minutes. The code is confirmed from the site (test phase) or the app.
import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { normalizeCode, pairingByCode, pairingState } from "./model";

// No 0/O, 1/I: easy to read off a screen. 32 symbols, so a random byte maps without bias.
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 6;
export const PAIRING_EXPIRES_MS = 10 * 60 * 1000; // FR-12

function newCode() {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export const start = mutation({
  args: { secretHash: v.string(), name: v.string(), os: v.string() },
  handler: async (ctx, args) => {
    if (!/^[0-9a-f]{64}$/.test(args.secretHash)) {
      throw new ConvexError("invalid device key");
    }
    // One open request per device: a new run of `pair` replaces the old code.
    const old = await ctx.db
      .query("pairingRequests")
      .withIndex("by_secretHash", (q) => q.eq("secretHash", args.secretHash))
      .collect();
    for (const r of old) {
      await ctx.db.delete(r._id);
    }
    let code = newCode();
    while (await pairingByCode(ctx, code)) {
      code = newCode();
    }
    const expiresAt = Date.now() + PAIRING_EXPIRES_MS;
    await ctx.db.insert("pairingRequests", {
      code,
      secretHash: args.secretHash,
      name: args.name.slice(0, 64),
      os: args.os.slice(0, 16),
      status: "pending",
      expiresAt,
    });
    return { code, expiresAt };
  },
});

// The agent subscribes to this while showing the QR code.
export const status = query({
  args: { code: v.string(), secretHash: v.string() },
  handler: async (ctx, args) => {
    const r = await pairingByCode(ctx, normalizeCode(args.code));
    if (!r || r.secretHash !== args.secretHash) {
      return "unknown";
    }
    return pairingState(r, Date.now());
  },
});
