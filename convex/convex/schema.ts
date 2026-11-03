// Subset of docs/Database.md: devices + latest. The full schema lands in week 2.
// Changes must be backward-compatible (add optional fields only) — docs/Development.md §3.
// isFake: true marks test rows; they are deleted before week 3.
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { battery, capabilities, driveLive, driveSummary, ramDetail, topProc } from "./validators";

export default defineSchema({
  devices: defineTable({
    name: v.string(),
    secretHash: v.string(), // SHA-256 hex of the device secret (docs/Security.md §6)
    lastSeenAt: v.number(),
    isFake: v.boolean(),
    // Live data flows only while this is in the future (docs/Flow.md §4, D3).
    viewerUntil: v.optional(v.number()),
    // Server time of the last accepted summary, for the 50 s limit (docs/Security.md §2).
    lastSummaryAt: v.optional(v.number()),
    // Reported by the agent at registration (FR-15).
    capabilities: v.optional(capabilities),
    agentVersion: v.optional(v.string()),
  }).index("by_secretHash", ["secretHash"]),

  latest: defineTable({
    deviceId: v.id("devices"),
    ts: v.number(),
    cpu: v.object({
      util: v.number(),
      packageTemp: v.optional(v.number()),
      perCoreUtil: v.optional(v.array(v.number())), // % per logical core
      clocks: v.optional(v.array(v.number())), // MHz per logical core
    }),
    ram: v.object({
      usedPct: v.number(),
      detail: v.optional(ramDetail),
      topProcs: v.optional(v.array(topProc)),
    }),
    disks: v.optional(v.array(driveLive)),
    uptimeSec: v.optional(v.number()),
    battery: v.optional(battery),
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

  // One row per device per minute: averages and peaks of the agent's 1 s samples
  // (docs/Database.md summaries). Collector status is added in Task 14.
  summaries: defineTable({
    deviceId: v.id("devices"),
    minuteTs: v.number(),
    cpuUtilAvg: v.number(),
    cpuUtilMax: v.number(),
    ramPctAvg: v.number(),
    ramPctMax: v.number(),
    cpuTempAvg: v.optional(v.number()),
    cpuTempMax: v.optional(v.number()),
    gpuTempMax: v.optional(v.number()),
    gpuUtilAvg: v.optional(v.number()),
    disks: v.optional(v.array(driveSummary)),
    batteryPct: v.optional(v.number()),
  })
    .index("by_device_time", ["deviceId", "minuteTs"])
    // For the daily retention job across all devices (FR-50).
    .index("by_minute", ["minuteTs"]),
});
