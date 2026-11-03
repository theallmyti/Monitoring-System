/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { RETENTION_MS } from "./summaries";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-20T10:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

async function seed(t: ReturnType<typeof convexTest>, minuteTs: number[]) {
  await t.run(async (ctx) => {
    const deviceId = await ctx.db.insert("devices", {
      name: "test-pc",
      secretHash: "a".repeat(64),
      lastSeenAt: Date.now(),
      isFake: true,
    });
    for (const m of minuteTs) {
      await ctx.db.insert("summaries", {
        deviceId,
        minuteTs: m,
        cpuUtilAvg: 10,
        cpuUtilMax: 20,
        ramPctAvg: 30,
        ramPctMax: 40,
      });
    }
  });
}

test("deleteOld removes summaries older than 7 days and keeps recent ones", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  await seed(t, [now - RETENTION_MS - 60_000, now - RETENTION_MS + 60_000, now - 60_000]);

  await t.mutation(internal.summaries.deleteOld, {});

  const left = await t.run((ctx) => ctx.db.query("summaries").collect());
  expect(left.map((s) => s.minuteTs).sort()).toEqual([now - RETENTION_MS + 60_000, now - 60_000]);
});

test("deleteOld keeps going in batches until all old rows are gone", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const old = Array.from({ length: 501 }, (_, i) => now - RETENTION_MS - (i + 1) * 60_000);
  await seed(t, [...old, now - 60_000]);

  await t.mutation(internal.summaries.deleteOld, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const left = await t.run((ctx) => ctx.db.query("summaries").collect());
  expect(left).toHaveLength(1);
  expect(left[0].minuteTs).toBe(now - 60_000);
});
