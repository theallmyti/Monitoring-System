// Subset of docs/Database.md: devices + latest. The full schema lands in week 2.
// Changes must be backward-compatible (add optional fields only) — docs/Development.md §3.
// isFake: true marks test rows; they are deleted before week 3.
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  devices: defineTable({
    name: v.string(),
    secretHash: v.string(), // SHA-256 hex of the device secret (docs/Security.md §6)
    lastSeenAt: v.number(),
    isFake: v.boolean(),
  }).index("by_secretHash", ["secretHash"]),

  latest: defineTable({
    deviceId: v.id("devices"),
    ts: v.number(),
    cpu: v.object({ util: v.number(), packageTemp: v.optional(v.number()) }),
    ram: v.object({ usedPct: v.number() }),
    // Optional: only NVIDIA machines send it. Units: MB, W, MHz, %.
    gpu: v.optional(
      v.object({
        temp: v.number(),
        util: v.number(),
        vramUsed: v.number(),
        vramTotal: v.number(),
        powerW: v.number(),
        clock: v.number(),
        fanPct: v.optional(v.number()),
      }),
    ),
    // Optional: Raspberry Pi containers. Counts come from the home-server dashboard.
    pi: v.optional(
      v.object({
        docker: v.optional(v.object({ running: v.number(), stopped: v.number(), errored: v.number() })),
      }),
    ),
  }).index("by_device", ["deviceId"]),

  // One sample per device per minute, for the history charts (docs/Database.md summaries).
  // Spike form: a single sample, not avg/max. Week 2 replaces it with the real aggregator.
  summaries: defineTable({
    deviceId: v.id("devices"),
    minuteTs: v.number(),
    cpuUtil: v.number(),
    ramPct: v.number(),
    cpuTemp: v.optional(v.number()),
    gpuTemp: v.optional(v.number()),
    gpuUtil: v.optional(v.number()),
    vramPct: v.optional(v.number()),
  }).index("by_device_time", ["deviceId", "minuteTs"]),
});
