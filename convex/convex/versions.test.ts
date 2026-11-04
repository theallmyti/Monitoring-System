/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { LATEST_AGENT_VERSION, MIN_AGENT_VERSION, compareVersions } from "./versions";

const modules = import.meta.glob("./**/*.ts");
const HASH = "e".repeat(64);

test("compareVersions compares numerically, not as text", () => {
  expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
  expect(compareVersions("1.0", "1.0.0")).toBe(0);
  expect(compareVersions("0.1.0", "0.2.0")).toBe(-1);
});

async function owned(t: ReturnType<typeof convexTest>, agentVersion?: string) {
  const { token } = await t.action(api.auth.signUp, { email: "v@example.com", password: "password one" });
  await t.run(async (ctx) => {
    const [user] = await ctx.db.query("users").collect();
    await ctx.db.insert("devices", { userId: user._id, name: "pc", secretHash: HASH, lastSeenAt: Date.now(), isFake: false, agentVersion });
  });
  return token;
}

test("hello refuses agents older than the minimum, and tells current ones the latest version", async () => {
  const t = convexTest(schema, modules);
  await owned(t);
  await expect(t.mutation(api.agent.hello, { secretHash: HASH, agentVersion: "0.0.1" })).rejects.toThrow(/too old/);
  expect(await t.mutation(api.agent.hello, { secretHash: HASH, agentVersion: MIN_AGENT_VERSION })).toMatchObject({
    owned: true,
    latestVersion: LATEST_AGENT_VERSION,
  });
  // Agents that do not report a version are not turned away.
  await t.mutation(api.agent.hello, { secretHash: HASH });
});

test("the site sees which devices run an older agent", async () => {
  const t = convexTest(schema, modules);
  const token = await owned(t, "0.0.1");
  const before = await t.query(api.dashboard.overview, { token });
  expect(before.devices[0]).toMatchObject({ agentVersion: "0.0.1", updateAvailable: true });

  await t.run(async (ctx) => {
    const [d] = await ctx.db.query("devices").collect();
    await ctx.db.patch(d._id, { agentVersion: LATEST_AGENT_VERSION });
  });
  const after = await t.query(api.dashboard.overview, { token });
  expect(after.devices[0].updateAvailable).toBe(false);
});

test("hello stores the CPU model and memory speed, and the site gets them", async () => {
  const t = convexTest(schema, modules);
  const token = await owned(t);
  const capabilities = {
    hasBattery: true,
    hasNvidiaGpu: true,
    perCoreTemps: false,
    isPi: false,
    drives: [{ name: "C:", totalGB: 476 }],
    cpuModel: "AMD Ryzen 7 4800H",
    ramSpeedMTs: 3200,
  };
  await t.mutation(api.agent.hello, { secretHash: HASH, agentVersion: LATEST_AGENT_VERSION, capabilities });
  const { devices } = await t.query(api.dashboard.overview, { token });
  expect(devices[0].capabilities).toMatchObject({ cpuModel: "AMD Ryzen 7 4800H", ramSpeedMTs: 3200 });
});
