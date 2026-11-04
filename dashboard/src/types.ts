// Shape returned by dashboard:overview (convex/convex/dashboard.ts).
export interface Latest {
  ts: number;
  // perCoreUtil (%), clocks (MHz), ram.detail (GB) and topProcs are sent only while someone is
  // watching; disks every 10 s while watching (convex/convex/schema.ts latest).
  cpu: { util: number; packageTemp?: number; perCoreUtil?: number[]; clocks?: number[] };
  ram: {
    usedPct: number;
    detail?: { used: number; free: number; total: number; swapUsed: number; swapTotal: number };
    topProcs?: { name: string; mb: number }[];
  };
  disks?: Drive[];
  uptimeSec?: number;
  battery?: { pct: number; charging: boolean; healthPct?: number; cycles?: number; rateW?: number };
  gpu?: { temp: number; util: number; vramUsed: number; vramTotal: number; powerW: number; clock: number; fanPct?: number };
  pi?: { docker?: { running: number; stopped: number; errored: number } };
}

export interface Drive {
  name: string;
  totalGB: number;
  freeGB: number;
}

// Reported once at agent start (convex/convex/validators.ts capabilities).
export interface Capabilities {
  hasBattery: boolean;
  hasNvidiaGpu: boolean;
  isPi: boolean;
  windowsMode?: "full" | "noDriver";
  drives: { name: string; totalGB: number }[];
  cpuModel?: string;
  ramSpeedMTs?: number;
}

export interface Device {
  id: string;
  name: string;
  lastSeenAt: number;
  online: boolean;
  agentVersion: string | null;
  updateAvailable: boolean;
  capabilities: Capabilities | null;
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
