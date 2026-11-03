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

test("register stores capabilities and agent version", async () => {
  const t = convexTest(schema, modules);
  const caps = {
    hasBattery: true,
    hasNvidiaGpu: true,
    perCoreTemps: false,
    windowsMode: "noDriver" as const,
    isPi: false,
    drives: [{ name: "C:", totalGB: 476 }],
  };
  const id = await t.mutation(api.agent.register, {
    registrationSecret: "team-secret",
    secretHash: HASH,
    name: "test-pc",
    capabilities: caps,
    agentVersion: "0.1.0",
  });
  const device = await t.run((ctx) => ctx.db.get(id));
  expect(device?.capabilities).toEqual(caps);
  expect(device?.agentVersion).toBe("0.1.0");
});

test("pushLatest stores per-core use, RAM detail, top processes, drives and uptime", async () => {
  const { t } = await setup();
  await t.mutation(api.agent.pushLatest, {
    secretHash: HASH,
    ts: Date.now(),
    cpuUtil: 20,
    ramUsedPct: 50,
    perCoreUtil: [10, 30],
    clocks: [3200, 3100],
    ram: { used: 8, free: 8, total: 16, swapUsed: 1, swapTotal: 4 },
    topProcs: [{ name: "chrome.exe", mb: 1500 }],
    disks: [{ name: "C:", totalGB: 476, freeGB: 120 }],
    uptimeSec: 3600,
  });
  const [row] = await t.run((ctx) => ctx.db.query("latest").collect());
  expect(row.cpu.perCoreUtil).toEqual([10, 30]);
  expect(row.ram.detail?.total).toBe(16);
  expect(row.ram.topProcs?.[0].name).toBe("chrome.exe");
  expect(row.disks?.[0].freeGB).toBe(120);
  expect(row.uptimeSec).toBe(3600);
});

test("impossible drive values are rejected", async () => {
  const { t } = await setup();
  await expect(
    t.mutation(api.agent.pushLatest, {
      secretHash: HASH,
      ts: Date.now(),
      cpuUtil: 20,
      ramUsedPct: 50,
      disks: [{ name: "C:", totalGB: 100, freeGB: 200 }],
    }),
  ).rejects.toThrow(/disk value out of range/);
  await expect(
    t.mutation(api.agent.pushSummary, {
      secretHash: HASH,
      minuteTs: 1,
      ...SUMMARY,
      disks: [{ name: "C:", freeGB: 10, freePct: 140 }],
    }),
  ).rejects.toThrow(/disk value out of range/);
});
