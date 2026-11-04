// Shapes shared by the schema and the agent functions (docs/Database.md).
import { v } from "convex/values";

// latest.disks: one entry per fixed drive (FR-26).
export const driveLive = v.object({ name: v.string(), totalGB: v.number(), freeGB: v.number() });

// summaries.disks: free space per drive at the end of the minute.
export const driveSummary = v.object({ name: v.string(), freeGB: v.number(), freePct: v.number() });

// latest.ram detail in GB (FR-23). "cached" is not reported on Windows, so it is left out.
export const ramDetail = v.object({
  used: v.number(),
  free: v.number(),
  total: v.number(),
  swapUsed: v.number(),
  swapTotal: v.number(),
});

// Top processes by memory, grouped by name (FR-23).
export const topProc = v.object({ name: v.string(), mb: v.number() });

// latest.battery on laptops (FR-25). rateW is charge or discharge power.
export const battery = v.object({
  pct: v.number(),
  charging: v.boolean(),
  healthPct: v.optional(v.number()),
  cycles: v.optional(v.number()),
  rateW: v.optional(v.number()),
});

// What the device can report, sent at registration (FR-15, docs/Database.md §2).
export const capabilities = v.object({
  hasBattery: v.boolean(),
  hasNvidiaGpu: v.boolean(),
  perCoreTemps: v.boolean(),
  windowsMode: v.optional(v.union(v.literal("full"), v.literal("noDriver"))),
  isPi: v.boolean(),
  drives: v.array(v.object({ name: v.string(), totalGB: v.number() })),
  // Fixed facts for the device page (agent 0.2.0+).
  cpuModel: v.optional(v.string()),
  ramSpeedMTs: v.optional(v.number()), // memory speed in MT/s, from SMBIOS (Windows)
});
