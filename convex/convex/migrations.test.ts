/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const DAY = 24 * 3_600_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-04T10:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "a@example.com", passwordHash: "x", createdAt: 0, setupDone: false });
    const device = (name: string, lastSeenAt: number, owned: boolean) =>
      ctx.db.insert("devices", {
        name,
        secretHash: name.padEnd(64, "0"),
        lastSeenAt,
        isFake: false,
        ...(owned ? { userId } : {}),
      });
    const oldOwnerless = await device("old-ownerless", Date.now() - 31 * DAY, false);
    await ctx.db.insert("summaries", { deviceId: oldOwnerless, minuteTs: 0, cpuUtilAvg: 1, cpuUtilMax: 1, ramPctAvg: 1, ramPctMax: 1 });
    await device("live-ownerless", Date.now() - 60_000, false);
    await device("old-owned", Date.now() - 90 * DAY, true);
  });
}

const names = async (t: ReturnType<typeof convexTest>) =>
  (await t.run((ctx) => ctx.db.query("devices").collect())).map((d) => d.name).sort();

test("listOwnerless shows only devices without an owner", async () => {
  const t = convexTest(schema, modules);
  await seed(t);
  const list = await t.query(internal.migrations.listOwnerless, {});
  expect(list.map((d) => d.name).sort()).toEqual(["live-ownerless", "old-ownerless"]);
});

test("removeOwnerless dry run changes nothing; the real run removes the device and its history", async () => {
  const t = convexTest(schema, modules);
  await seed(t);
  expect(await t.mutation(internal.migrations.removeOwnerless, { notSeenForDays: 0, dryRun: true })).toEqual({
    removed: [],
    wouldRemove: expect.arrayContaining(["old-ownerless", "live-ownerless"]),
  });
  expect(await names(t)).toHaveLength(3);

  await t.mutation(internal.migrations.removeOwnerless, { notSeenForDays: 0, dryRun: false });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await names(t)).toEqual(["old-owned"]);
  expect(await t.run((ctx) => ctx.db.query("summaries").collect())).toHaveLength(0);
});

test("the daily job removes ownerless devices idle for 30 days, never owned ones", async () => {
  const t = convexTest(schema, modules);
  await seed(t);
  expect(await t.mutation(internal.migrations.removeIdleOwnerless, {})).toBe(1);
  expect(await names(t)).toEqual(["live-ownerless", "old-owned"]);
});
