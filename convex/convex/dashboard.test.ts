/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-04T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

// A user with one paired device.
async function userWithDevice(t: ReturnType<typeof convexTest>, email: string, hash: string) {
  const { token } = await t.action(api.auth.signUp, { email, password: "password one" });
  const { code } = await t.mutation(api.pairing.start, { secretHash: hash, name: email, os: "windows" });
  const { deviceId } = (await t.mutation(api.dashboard.confirmPairing, { token, code }))!;
  return { token, deviceId: deviceId as Id<"devices"> };
}

test("each user sees only their own devices (T-12)", async () => {
  const t = convexTest(schema, modules);
  const aditya = await userWithDevice(t, "aditya@example.com", "a".repeat(64));
  const tirth = await userWithDevice(t, "tirth@example.com", "b".repeat(64));

  const mine = await t.query(api.dashboard.overview, { token: aditya.token });
  expect(mine.devices.map((d) => d.id)).toEqual([aditya.deviceId]);

  // Knowing another user's device id is not enough.
  await expect(
    t.query(api.dashboard.history, { token: tirth.token, deviceId: aditya.deviceId, sinceMs: 0 }),
  ).rejects.toThrow(/device not found/);
  await expect(
    t.mutation(api.dashboard.setViewer, { token: tirth.token, deviceId: aditya.deviceId }),
  ).rejects.toThrow(/device not found/);
  await expect(
    t.mutation(api.dashboard.removeDevice, { token: tirth.token, deviceId: aditya.deviceId }),
  ).rejects.toThrow(/device not found/);
});

test("signed out users get nothing", async () => {
  const t = convexTest(schema, modules);
  const { token } = await userWithDevice(t, "aditya@example.com", "a".repeat(64));
  await t.mutation(api.auth.signOut, { token });
  await expect(t.query(api.dashboard.overview, { token })).rejects.toThrow(/signed out/);
});

test("the owner can rename and remove a device; removal revokes its secret (T-13)", async () => {
  const t = convexTest(schema, modules);
  const hash = "a".repeat(64);
  const { token, deviceId } = await userWithDevice(t, "aditya@example.com", hash);

  await t.mutation(api.dashboard.renameDevice, { token, deviceId, name: "  Gaming laptop " });
  expect((await t.run((ctx) => ctx.db.get(deviceId)))?.name).toBe("Gaming laptop");

  await t.mutation(api.dashboard.removeDevice, { token, deviceId });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await t.query(api.dashboard.overview, { token })).devices).toHaveLength(0);
  await expect(
    t.mutation(api.agent.pushLatest, { secretHash: hash, ts: Date.now(), cpuUtil: 1, ramUsedPct: 1 }),
  ).rejects.toThrow(/unknown device/);
});
