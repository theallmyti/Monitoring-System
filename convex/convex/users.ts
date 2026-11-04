// Internal account steps used by auth.ts actions (not callable from clients).
import { internalMutation, internalQuery } from "./_generated/server";
import { v, ConvexError } from "convex/values";

// FR-04: 5 failed sign-ins per 15 minutes per email.
export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
export const MAX_ATTEMPTS = 5;

export const byEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique(),
});

export const create = internalMutation({
  args: { email: v.string(), passwordHash: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();
    if (existing) {
      throw new ConvexError("An account with this email already exists. Sign in instead.");
    }
    return await ctx.db.insert("users", {
      email: args.email,
      passwordHash: args.passwordHash,
      createdAt: Date.now(),
      setupDone: false,
    });
  },
});

export const startSession = internalMutation({
  args: { userId: v.id("users"), tokenHash: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("sessions", { ...args, lastUsedAt: Date.now() });
  },
});

export const recentAttempts = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const since = Date.now() - ATTEMPT_WINDOW_MS;
    const rows = await ctx.db
      .query("loginAttempts")
      .withIndex("by_email_at", (q) => q.eq("email", args.email).gt("at", since))
      .take(MAX_ATTEMPTS);
    return rows.length;
  },
});

export const recordAttempt = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("loginAttempts", { email: args.email, at: Date.now() });
  },
});

export const clearAttempts = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("loginAttempts")
      .withIndex("by_email_at", (q) => q.eq("email", args.email))
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);
  },
});
