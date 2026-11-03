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
  latest: Latest | null;
}

export interface Overview {
  now: number;
  devices: Device[];
}
