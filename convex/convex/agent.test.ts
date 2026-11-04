/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const HASH = "a".repeat(64);
const SUMMARY = { cpuUtilAvg: 20, cpuUtilMax: 40, ramPctAvg: 50, ramPctMax: 55 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-03T10:00:00Z"));
  vi.stubEnv("AGENT_REGISTRATION_SECRET", "team-secret");
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

  vi.advanceTimersByTime(60_000); // next minute, past the 50 s gap
  await t.mutation(api.agent.pushSummary, { secretHash: HASH, minuteTs: 3, ...SUMMARY });
  const rows = await t.run((ctx) => ctx.db.query("summaries").collect());
  expect(rows).toHaveLength(2);
});

test("pushSummary files the minute by the server's clock, not the PC's", async () => {
  const { t } = await setup();
  const dayAhead = Date.now() + 24 * 3_600_000;
  await t.mutation(api.agent.pushSummary, { secretHash: HASH, minuteTs: dayAhead, ...SUMMARY });
  const [row] = await t.run((ctx) => ctx.db.query("summaries").collect());
  expect(row.minuteTs).toBe(Math.floor(Date.now() / 60_000) * 60_000);
});

test("a second summary in the same server minute replaces the first (no duplicates)", async () => {
  vi.setSystemTime(new Date("2026-11-03T10:00:05Z"));
  const { t } = await setup();
  await t.mutation(api.agent.pushSummary, { secretHash: HASH, minuteTs: 0, ...SUMMARY });
  vi.advanceTimersByTime(52_000); // 10:00:57, still the same minute
  await t.mutation(api.agent.pushSummary, { secretHash: HASH, minuteTs: 0, ...SUMMARY, cpuUtilMax: 90 });
  const rows = await t.run((ctx) => ctx.db.query("summaries").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].cpuUtilMax).toBe(90);
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

test("watchViewer follows setViewer from the device owner", async () => {
  const { t, deviceId } = await setup();
  expect(await t.query(api.agent.watchViewer, { secretHash: HASH })).toBe(0);

  const { token } = await t.action(api.auth.signUp, { email: "owner@example.com", password: "password one" });
  const [user] = await t.run((ctx) => ctx.db.query("users").collect());
  await t.run((ctx) => ctx.db.patch(deviceId, { userId: user._id }));

  const before = Date.now();
  await t.mutation(api.dashboard.setViewer, { token, deviceId });
  const until = await t.query(api.agent.watchViewer, { secretHash: HASH });
  expect(until).toBeGreaterThanOrEqual(before + 30_000);
  expect(until).toBeLessThan(before + 31_000);

  await expect(
    t.mutation(api.dashboard.setViewer, { token: "f".repeat(64), deviceId }),
  ).rejects.toThrow(/signed out/);
});

test("pushLatest updates the latest row and writes no history", async () => {
  const { t } = await setup();
  await t.mutation(api.agent.pushLatest, { secretHash: HASH, ts: Date.now(), cpuUtil: 10, ramUsedPct: 30 });
  await t.mutation(api.agent.pushLatest, { secretHash: HASH, ts: Date.now(), cpuUtil: 12, ramUsedPct: 31 });

  const latest = await t.run((ctx) => ctx.db.query("latest").collect());
  expect(latest).toHaveLength(1);
  expect(latest[0].cpu.util).toBe(12);

  // The time is the server's, even when the PC's clock is an hour off.
  await t.mutation(api.agent.pushLatest, { secretHash: HASH, ts: Date.now() + 3_600_000, cpuUtil: 12, ramUsedPct: 31 });
  const [row] = await t.run((ctx) => ctx.db.query("latest").collect());
  expect(Math.abs(row.ts - Date.now())).toBeLessThan(1000);
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

test("pushLatest stores the battery and rejects impossible charge", async () => {
  const { t } = await setup();
  const base = { secretHash: HASH, ts: Date.now(), cpuUtil: 20, ramUsedPct: 50 };
  await t.mutation(api.agent.pushLatest, {
    ...base,
    battery: { pct: 80, charging: true, healthPct: 92, cycles: 140, rateW: 35 },
  });
  const [row] = await t.run((ctx) => ctx.db.query("latest").collect());
  expect(row.battery).toEqual({ pct: 80, charging: true, healthPct: 92, cycles: 140, rateW: 35 });

  await expect(
    t.mutation(api.agent.pushLatest, { ...base, battery: { pct: 120, charging: false } }),
  ).rejects.toThrow(/battery value out of range/);
});

test("unpair removes the device, its live row and all history", async () => {
  const { t, deviceId } = await setup();
  await t.mutation(api.agent.pushLatest, { secretHash: HASH, ts: Date.now(), cpuUtil: 10, ramUsedPct: 20 });
  await t.run(async (ctx) => {
    for (let i = 0; i < 600; i++) {
      await ctx.db.insert("summaries", { deviceId, minuteTs: i * 60_000, ...SUMMARY });
    }
  });

  expect(await t.mutation(api.agent.unpair, { secretHash: HASH })).toBe(true);
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(await t.run((ctx) => ctx.db.get(deviceId))).toBeNull();
  expect(await t.run((ctx) => ctx.db.query("latest").collect())).toHaveLength(0);
  expect(await t.run((ctx) => ctx.db.query("summaries").collect())).toHaveLength(0);
  // Running it again (uninstall twice) is harmless.
  expect(await t.mutation(api.agent.unpair, { secretHash: HASH })).toBe(false);
});

describe("pushSummaries (offline backlog)", () => {
  const MIN = 60_000;
  const minuteNow = () => Math.floor(Date.now() / MIN) * MIN;

  test("files each minute by the server's clock, even when the PC's clock is a day ahead", async () => {
    const { t } = await setup();
    const agentNow = Date.now() + 24 * 3_600_000; // the PC's clock
    const summaries = [2, 1, 0].map((ago) => ({ minuteTs: agentNow - ago * MIN, ...SUMMARY }));
    expect(await t.mutation(api.agent.pushSummaries, { secretHash: HASH, sentAt: agentNow, summaries })).toEqual({
      stored: 3,
      skipped: 0,
      tooSoon: false,
    });
    const rows = await t.run((ctx) => ctx.db.query("summaries").collect());
    expect(rows.map((r) => r.minuteTs).sort()).toEqual([minuteNow() - 2 * MIN, minuteNow() - MIN, minuteNow()]);
  });

  test("a retried batch makes no duplicates; a call within 50 s is deferred, not an error", async () => {
    const { t } = await setup();
    const sentAt = Date.now();
    const summaries = [1, 0].map((ago) => ({ minuteTs: sentAt - ago * MIN, ...SUMMARY }));
    await t.mutation(api.agent.pushSummaries, { secretHash: HASH, sentAt, summaries });
    expect(await t.mutation(api.agent.pushSummaries, { secretHash: HASH, sentAt, summaries })).toEqual({
      stored: 0,
      skipped: 0,
      tooSoon: true,
    });

    // The answer was lost, so the agent sends the same minutes again a minute later.
    vi.advanceTimersByTime(MIN);
    await t.mutation(api.agent.pushSummaries, { secretHash: HASH, sentAt: sentAt + MIN, summaries });
    const rows = await t.run((ctx) => ctx.db.query("summaries").collect());
    expect(rows.map((r) => r.minuteTs).sort()).toEqual([minuteNow() - 2 * MIN, minuteNow() - MIN]);
  });

  test("skips impossible, future and too-old rows instead of failing the batch", async () => {
    const { t } = await setup();
    const now = Date.now();
    const summaries = [
      { minuteTs: now, ...SUMMARY },
      { minuteTs: now - MIN, ...SUMMARY, cpuUtilMax: 140 }, // impossible
      { minuteTs: now + 10 * MIN, ...SUMMARY }, // future
      { minuteTs: now - 8 * 24 * 3_600_000, ...SUMMARY }, // older than the 7-day retention
    ];
    expect(await t.mutation(api.agent.pushSummaries, { secretHash: HASH, sentAt: now, summaries })).toEqual({
      stored: 1,
      skipped: 3,
      tooSoon: false,
    });
  });

  test("rejects empty or oversized batches and unknown devices", async () => {
    const { t } = await setup();
    const one = { minuteTs: Date.now(), ...SUMMARY };
    await expect(t.mutation(api.agent.pushSummaries, { secretHash: HASH, sentAt: Date.now(), summaries: [] })).rejects.toThrow(/1 to 60/);
    await expect(
      t.mutation(api.agent.pushSummaries, { secretHash: HASH, sentAt: Date.now(), summaries: Array(61).fill(one) }),
    ).rejects.toThrow(/1 to 60/);
    await expect(
      t.mutation(api.agent.pushSummaries, { secretHash: "b".repeat(64), sentAt: Date.now(), summaries: [one] }),
    ).rejects.toThrow(/unknown device/);
  });
});
