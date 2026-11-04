/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const EMAIL = "aditya@example.com";
const PASSWORD = "correct horse";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-04T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

test("sign up stores a scrypt hash, never the password, and signs in", async () => {
  const t = convexTest(schema, modules);
  const { token } = await t.action(api.auth.signUp, { email: " Aditya@Example.com ", password: PASSWORD });
  const [user] = await t.run((ctx) => ctx.db.query("users").collect());
  expect(user.email).toBe(EMAIL); // lowercase, trimmed
  expect(user.passwordHash).toMatch(/^scrypt\$32768\$8\$1\$/);
  expect(user.passwordHash).not.toContain(PASSWORD);
  const [session] = await t.run((ctx) => ctx.db.query("sessions").collect());
  expect(session.tokenHash).not.toBe(token); // only the hash is stored
  expect(await t.query(api.auth.me, { token })).toEqual({ email: EMAIL });
});

test("sign up rejects short passwords, bad emails and duplicates", async () => {
  const t = convexTest(schema, modules);
  await expect(t.action(api.auth.signUp, { email: EMAIL, password: "short" })).rejects.toThrow(/at least 8/);
  await expect(t.action(api.auth.signUp, { email: "not-an-email", password: PASSWORD })).rejects.toThrow(/valid email/);
  await t.action(api.auth.signUp, { email: EMAIL, password: PASSWORD });
  await expect(t.action(api.auth.signUp, { email: EMAIL, password: PASSWORD })).rejects.toThrow(/already exists/);
});

test("wrong password and unknown email give the same message", async () => {
  const t = convexTest(schema, modules);
  await t.action(api.auth.signUp, { email: EMAIL, password: PASSWORD });
  await expect(t.action(api.auth.signIn, { email: EMAIL, password: "wrong password" })).rejects.toThrow(
    "Wrong email or password.",
  );
  await expect(t.action(api.auth.signIn, { email: "nobody@example.com", password: PASSWORD })).rejects.toThrow(
    "Wrong email or password.",
  );
  const { token } = await t.action(api.auth.signIn, { email: EMAIL, password: PASSWORD });
  expect(await t.query(api.auth.me, { token })).toEqual({ email: EMAIL });
});

test("sign in is blocked after 5 failed attempts for 15 minutes (T-02)", async () => {
  const t = convexTest(schema, modules);
  await t.action(api.auth.signUp, { email: EMAIL, password: PASSWORD });
  for (let i = 0; i < 5; i++) {
    await expect(t.action(api.auth.signIn, { email: EMAIL, password: "wrong password" })).rejects.toThrow(/Wrong/);
  }
  // Even the right password is refused while blocked.
  await expect(t.action(api.auth.signIn, { email: EMAIL, password: PASSWORD })).rejects.toThrow(/Too many attempts/);
  vi.advanceTimersByTime(15 * 60 * 1000 + 1);
  const { token } = await t.action(api.auth.signIn, { email: EMAIL, password: PASSWORD });
  expect(token).toMatch(/^[0-9a-f]{64}$/);
});

test("sign out ends the session; idle sessions expire after 30 days (FR-02, FR-03, T-06)", async () => {
  const t = convexTest(schema, modules);
  const { token } = await t.action(api.auth.signUp, { email: EMAIL, password: PASSWORD });
  await t.mutation(api.auth.signOut, { token });
  expect(await t.query(api.auth.me, { token })).toBeNull();

  const second = await t.action(api.auth.signIn, { email: EMAIL, password: PASSWORD });
  expect(await t.query(api.auth.me, { token: second.token })).toEqual({ email: EMAIL });
  // Last used just over 30 days ago: expired.
  const [session] = await t.run((ctx) => ctx.db.query("sessions").collect());
  await t.run((ctx) => ctx.db.patch(session._id, { lastUsedAt: Date.now() - 30 * 24 * 60 * 60 * 1000 - 1 }));
  expect(await t.query(api.auth.me, { token: second.token })).toBeNull();
});
