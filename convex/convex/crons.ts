// Scheduled jobs (docs/Architecture.md §3.1). Offline check and canary come in Tasks 11 and 19.
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// FR-50: keep 7 days of summaries.
crons.daily("delete old summaries", { hourUTC: 21, minuteUTC: 30 }, internal.summaries.deleteOld, {});

// Rate-limit events, failed sign-ins and expired pairing codes (cleanup.ts).
crons.daily("delete expired rows", { hourUTC: 21, minuteUTC: 45 }, internal.cleanup.deleteExpired, {});

export default crons;
