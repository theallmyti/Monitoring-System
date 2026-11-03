// Subset of docs/Database.md: devices + latest. The full schema lands in week 2.
// Changes must be backward-compatible (add optional fields only) — docs/Development.md §3.
// isFake: true marks spike/test rows; they are deleted before week 3.
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
    cpu: v.object({ util: v.number() }),
    ram: v.object({ usedPct: v.number() }),
  }).index("by_device", ["deviceId"]),
});
