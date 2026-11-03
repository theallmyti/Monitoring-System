/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const HASH = "a".repeat(64);
const SUMMARY = { cpuUtilAvg: 20, cpuUtilMax: 40, ramPctAvg: 50, ramPctMax: 55 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-03T10:00:00Z"));
  vi.stubEnv("AGENT_REGISTRATION_SECRET", "team-secret");
  vi.stubEnv("DASHBOARD_READ_TOKEN", "read-token");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function setup() {
  const t = convexTest(schema, modules);
  const deviceId = await t.mutation(api.agent.register, {
    registrationSecret: "team-secret",
    secretHash: HASH,
    name: "test-pc",
  });
  return { t, deviceId };
}

test("pushSummary stores the minute and marks the device as seen", async () => {
  const { t, deviceId } = await setup();
  vi.advanceTimersByTime(60_000);
  await t.mutation(api.agent.pushSummary, { secretHash: HASH, minuteTs: Date.now(), ...SUMMARY });

  const rows = await t.run((ctx) => ctx.db.query("summaries").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].cpuUtilMax).toBe(40);
  const device = await t.run((ctx) => ctx.db.get(deviceId));
  expect(device?.lastSeenAt).toBe(Date.now());
});

test("pushSummary accepts at most one summary per 50 s", async () => {
  const { t } = await setup();
  await t.mutation(api.agent.pushSummary, { secretHash: HASH, minuteTs: 1, ...SUMMARY });
  await expect(
    t.mutation(api.agent.pushSummary, { secretHash: HASH, minuteTs: 2, ...SUMMARY }),
  ).rejects.toThrow(/too soon/);

  vi.advanceTimersByTime(50_000);
  await t.mutation(api.agent.pushSummary, { secretHash: HASH, minuteTs: 3, ...SUMMARY });
  const rows = await t.run((ctx) => ctx.db.query("summaries").collect());
  expect(rows).toHaveLength(2);
});

test("pushSummary rejects impossible values and unknown devices", async () => {
  const { t } = await setup();
  await expect(
    t.mutation(api.agent.pushSummary, { secretHash: HASH, minuteTs: 1, ...SUMMARY, cpuUtilMax: 140 }),
  ).rejects.toThrow(/out of range/);
  await expect(
    t.mutation(api.agent.pushSummary, { secretHash: HASH, minuteTs: 1, ...SUMMARY, cpuTempMax: 130 }),
  ).rejects.toThrow(/out of range/);
  await expect(
    t.mutation(api.agent.pushSummary, { secretHash: "b".repeat(64), minuteTs: 1, ...SUMMARY }),
  ).rejects.toThrow(/unknown device/);
});

test("watchViewer follows setViewer, which needs the read token", async () => {
  const { t, deviceId } = await setup();
  expect(await t.query(api.agent.watchViewer, { secretHash: HASH })).toBe(0);

  await t.mutation(api.dashboard.setViewer, { token: "read-token", deviceId });
  expect(await t.query(api.agent.watchViewer, { secretHash: HASH })).toBe(Date.now() + 30_000);

  await expect(
    t.mutation(api.dashboard.setViewer, { token: "wrong", deviceId }),
  ).rejects.toThrow(/not authorized/);
});

test("pushLatest updates the latest row and writes no history", async () => {
  const { t } = await setup();
  await t.mutation(api.agent.pushLatest, { secretHash: HASH, ts: Date.now(), cpuUtil: 10, ramUsedPct: 30 });
  await t.mutation(api.agent.pushLatest, { secretHash: HASH, ts: Date.now(), cpuUtil: 12, ramUsedPct: 31 });

  const latest = await t.run((ctx) => ctx.db.query("latest").collect());
  expect(latest).toHaveLength(1);
  expect(latest[0].cpu.util).toBe(12);
  expect(await t.run((ctx) => ctx.db.query("summaries").collect())).toHaveLength(0);
});
