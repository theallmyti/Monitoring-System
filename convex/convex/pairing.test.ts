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
});

afterEach(() => {
  vi.useRealTimers();
});

async function signedIn(t: ReturnType<typeof convexTest>, email = "aditya@example.com") {
  const { token } = await t.action(api.auth.signUp, { email, password: "password one" });
  return token;
}

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

test("the signed-in user who confirms becomes the owner; then hello reports owned", async () => {
  const t = convexTest(schema, modules);
  const token = await signedIn(t);
  await expect(t.mutation(api.agent.hello, { secretHash: HASH })).rejects.toThrow(/not paired/);

  const { code } = await t.mutation(api.pairing.start, DEVICE);
  const info = await t.query(api.dashboard.pairingInfo, { token, code: code.toLowerCase() });
  expect(info).toEqual({ name: "test-pc", os: "windows", state: "pending" });

  const { deviceId } = await t.mutation(api.dashboard.confirmPairing, { token, code });
  expect(await t.query(api.pairing.status, { code, secretHash: HASH })).toBe("confirmed");
  const device = await t.run((ctx) => ctx.db.get(deviceId));
  const [user] = await t.run((ctx) => ctx.db.query("users").collect());
  expect(device?.userId).toBe(user._id);
  expect(device?.isFake).toBe(false);

  expect(await t.mutation(api.agent.hello, { secretHash: HASH, agentVersion: "0.1.0" })).toEqual({
    deviceId,
    owned: true,
  });
});

test("a device paired before accounts (no owner) is claimed by pairing it again", async () => {
  const t = convexTest(schema, modules);
  const token = await signedIn(t);
  const oldId = await t.run((ctx) =>
    ctx.db.insert("devices", { name: "old-pc", secretHash: HASH, lastSeenAt: 0, isFake: false }),
  );
  expect(await t.mutation(api.agent.hello, { secretHash: HASH })).toEqual({ deviceId: oldId, owned: false });

  const { code } = await t.mutation(api.pairing.start, DEVICE);
  const { deviceId } = await t.mutation(api.dashboard.confirmPairing, { token, code });
  expect(deviceId).toBe(oldId); // same device, history kept
  expect(await t.mutation(api.agent.hello, { secretHash: HASH })).toEqual({ deviceId: oldId, owned: true });
});

test("an expired code cannot be confirmed", async () => {
  const t = convexTest(schema, modules);
  const token = await signedIn(t);
  const { code } = await t.mutation(api.pairing.start, DEVICE);
  // The 10 minutes have passed.
  const [request] = await t.run((ctx) => ctx.db.query("pairingRequests").collect());
  await t.run((ctx) => ctx.db.patch(request._id, { expiresAt: Date.now() - 1 }));
  expect(await t.query(api.pairing.status, { code, secretHash: HASH })).toBe("expired");
  await expect(t.mutation(api.dashboard.confirmPairing, { token, code })).rejects.toThrow(/not found or expired/);
});

test("confirming needs a signed-in user, and status needs the right device", async () => {
  const t = convexTest(schema, modules);
  const { code } = await t.mutation(api.pairing.start, DEVICE);
  await expect(t.mutation(api.dashboard.confirmPairing, { token: "f".repeat(64), code })).rejects.toThrow(
    /signed out/,
  );
  expect(await t.query(api.pairing.status, { code, secretHash: "d".repeat(64) })).toBe("unknown");
  await expect(t.mutation(api.pairing.start, { ...DEVICE, secretHash: "not-a-hash" })).rejects.toThrow(
    /invalid device key/,
  );
});
