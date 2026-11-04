// Shape returned by dashboard:overview (convex/convex/dashboard.ts).
export interface Latest {
  ts: number;
  cpu: { util: number; packageTemp?: number };
  ram: { usedPct: number };
  gpu?: { temp: number; util: number; vramUsed: number; vramTotal: number; powerW: number; clock: number; fanPct?: number };
  pi?: { docker?: { running: number; stopped: number; errored: number } };
}

export interface Device {
  id: string;
  name: string;
  lastSeenAt: number;
  online: boolean;
  agentVersion: string | null;
  updateAvailable: boolean;
  latest: Latest | null;
}

export interface Overview {
  now: number;
  latestAgentVersion: string;
  devices: Device[];
}

// One stored minute: averages and peaks (convex/convex/schema.ts summaries).
export interface Summary {
  _id: string;
  deviceId: string;
  minuteTs: number;
  cpuUtilAvg: number;
  cpuUtilMax: number;
  ramPctAvg: number;
  ramPctMax: number;
  cpuTempAvg?: number;
  cpuTempMax?: number;
  gpuTempMax?: number;
  gpuUtilAvg?: number;
}

export interface Range {
  label: string;
  hours: number;
}

export const RANGES: Range[] = [
  { label: "1 h", hours: 1 },
  { label: "6 h", hours: 6 },
  { label: "24 h", hours: 24 },
];
