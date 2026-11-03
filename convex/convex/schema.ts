// Spike schema (S4). The full schema from docs/Database.md is written in week 2.
// Spike rows are flagged isFake: true and are deleted before week 3 (docs/Development.md §3).
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  spikeLatest: defineTable({
    deviceName: v.string(),
    ts: v.number(),
    cpuUtil: v.number(),
    ramUsedPct: v.number(),
    isFake: v.boolean(),
  }).index("by_device", ["deviceName"]),
});
