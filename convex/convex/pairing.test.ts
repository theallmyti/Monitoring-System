/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const HASH = "c".repeat(64);
const DEVICE = { secretHash: HASH, name: "test-pc", os: "windows" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-04T10:00:00Z"));
  vi.stubEnv("DASHBOARD_READ_TOKEN", "read-token");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

test("start returns a readable 6-character code valid for 10 minutes", async () => {
  const t = convexTest(schema, modules);
  const { code, expiresAt } = await t.mutation(api.pairing.start, DEVICE);
  expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  expect(expiresAt).toBe(Date.now() + 10 * 60 * 1000);
  expect(await t.query(api.pairing.status, { code, secretHash: HASH })).toBe("pending");
});

test("running pair again replaces the previous code", async () => {
  const t = convexTest(schema, modules);
  const first = await t.mutation(api.pairing.start, DEVICE);
  const second = await t.mutation(api.pairing.start, DEVICE);
  expect(await t.query(api.pairing.status, { code: first.code, secretHash: HASH })).toBe("unknown");
  expect(await t.query(api.pairing.status, { code: second.code, secretHash: HASH })).toBe("pending");
});

test("confirming from the site creates the device; then hello works", async () => {
  const t = convexTest(schema, modules);
  await expect(t.mutation(api.agent.hello, { secretHash: HASH })).rejects.toThrow(/not paired/);

  const { code } = await t.mutation(api.pairing.start, DEVICE);
  const info = await t.query(api.dashboard.pairingInfo, { token: "read-token", code: code.toLowerCase() });
  expect(info).toEqual({ name: "test-pc", os: "windows", state: "pending" });

  const { deviceId } = await t.mutation(api.dashboard.confirmPairing, { token: "read-token", code });
  expect(await t.query(api.pairing.status, { code, secretHash: HASH })).toBe("confirmed");
  const device = await t.run((ctx) => ctx.db.get(deviceId));
  expect(device?.name).toBe("test-pc");
  expect(device?.isFake).toBe(false);

  expect(await t.mutation(api.agent.hello, { secretHash: HASH, agentVersion: "0.1.0" })).toBe(deviceId);
});

test("an expired code cannot be confirmed", async () => {
  const t = convexTest(schema, modules);
  const { code } = await t.mutation(api.pairing.start, DEVICE);
  vi.advanceTimersByTime(10 * 60 * 1000 + 1);
  expect(await t.query(api.pairing.status, { code, secretHash: HASH })).toBe("expired");
  await expect(
    t.mutation(api.dashboard.confirmPairing, { token: "read-token", code }),
  ).rejects.toThrow(/not found or expired/);
});

test("confirming needs the read token, and status needs the right device", async () => {
  const t = convexTest(schema, modules);
  const { code } = await t.mutation(api.pairing.start, DEVICE);
  await expect(
    t.mutation(api.dashboard.confirmPairing, { token: "wrong", code }),
  ).rejects.toThrow(/not authorized/);
  expect(await t.query(api.pairing.status, { code, secretHash: "d".repeat(64) })).toBe("unknown");
  await expect(
    t.mutation(api.pairing.start, { ...DEVICE, secretHash: "not-a-hash" }),
  ).rejects.toThrow(/invalid device key/);
});
