// Accounts: sign up, sign in, sign out (FR-01–FR-04, docs/Flow.md §1, docs/Security.md §3–4).
// Passwords are hashed with scrypt in actions (CPU-heavy work does not belong in mutations).
// Clients keep only the returned session token; the backend stores its SHA-256.
import { action, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import { dummyHash, hashPassword, newToken, tokenHash, verifyPassword } from "./passwords";
import { sessionUser } from "./model";
import { MAX_ATTEMPTS, SIGNUP_LIMITED } from "./users";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8; // FR-01

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export const signUp = action({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, args): Promise<{ token: string }> => {
    const email = normalizeEmail(args.email);
    if (!EMAIL.test(email)) {
      throw new ConvexError("Enter a valid email address.");
    }
    if (args.password.length < MIN_PASSWORD) {
      throw new ConvexError(`Use at least ${MIN_PASSWORD} characters for the password.`);
    }
    if (await ctx.runQuery(internal.users.signupLimited, {})) {
      throw new ConvexError(SIGNUP_LIMITED);
    }
    const userId = await ctx.runMutation(internal.users.create, {
      email,
      passwordHash: hashPassword(args.password),
    });
    const token = newToken();
    await ctx.runMutation(internal.users.startSession, { userId, tokenHash: tokenHash(token) });
    return { token };
  },
});

export const signIn = action({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, args): Promise<{ token: string }> => {
    const email = normalizeEmail(args.email);
    if ((await ctx.runQuery(internal.users.recentAttempts, { email })) >= MAX_ATTEMPTS) {
      throw new ConvexError("Too many attempts. Try again in 15 minutes.");
    }
    const user = await ctx.runQuery(internal.users.byEmail, { email });
    // Same work and the same message for an unknown email and a wrong password.
    const ok = verifyPassword(args.password, user?.passwordHash ?? dummyHash());
    if (!user || !ok) {
      await ctx.runMutation(internal.users.recordAttempt, { email });
      throw new ConvexError("Wrong email or password.");
    }
    await ctx.runMutation(internal.users.clearAttempts, { email });
    const token = newToken();
    await ctx.runMutation(internal.users.startSession, {
      userId: user._id,
      tokenHash: tokenHash(token),
    });
    return { token };
  },
});

// FR-03: the session is deleted server-side.
export const signOut = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash(args.token)))
      .unique();
    if (session) await ctx.db.delete(session._id);
  },
});

// Who is signed in with this token; null when signed out or expired.
export const me = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const found = await sessionUser(ctx, args.token);
    return found ? { email: found.user.email } : null;
  },
});
