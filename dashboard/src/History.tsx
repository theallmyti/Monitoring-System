import { useQuery } from "convex/react";
import { anyApi } from "convex/server";
import { Latest, Range, Summary } from "./types";
import { LineChart, Point } from "./LineChart";

// Default alert thresholds from docs/PRD.md §5.
export const CPU_TEMP_LIMIT = 90;
export const GPU_TEMP_LIMIT = 85;
export const RAM_LIMIT = 90;

const HOUR = 3_600_000;

// Per-minute history for the chosen range. Two queries: whole past hours (arguments change once
// an hour, and new summaries do not re-run it) and the current hour (small, updates every
// minute). Saves Convex reads.
export function useHistory(token: string, deviceId: string, range: Range) {
  const hourStart = Math.floor(Date.now() / HOUR) * HOUR;
  const older = useQuery(anyApi.dashboard.history, {
    token,
    deviceId,
    sinceMs: hourStart - range.hours * HOUR,
    untilMs: hourStart,
  }) as Summary[] | undefined;
  const recent = useQuery(anyApi.dashboard.history, { token, deviceId, sinceMs: hourStart }) as
    | Summary[]
    | undefined;
  const cutoff = Date.now() - range.hours * HOUR;
  return older && recent ? [...older, ...recent].filter((s) => s.minuteTs >= cutoff) : undefined;
}

export function HistoryCharts({ history, latest }: { history: Summary[] | undefined; latest: Latest }) {
  const series = (pick: (s: Summary) => number | undefined): Point[] =>
    (history ?? []).flatMap((s) => {
      const v = pick(s);
      return v === undefined ? [] : [{ t: s.minuteTs, v }];
    });
  return (
    <div className="charts">
      <LineChart title="CPU use · avg" unit="%" points={series((s) => s.cpuUtilAvg)} min={0} max={100} />
      <LineChart title="RAM · avg" unit="%" points={series((s) => s.ramPctAvg)} min={0} max={100} limit={RAM_LIMIT} />
      {latest.cpu.packageTemp !== undefined && (
        <LineChart
          title="CPU temperature · peak"
          unit="°C"
          points={series((s) => s.cpuTempMax)}
          min={20}
          max={Math.max(100, CPU_TEMP_LIMIT + 5)}
          limit={CPU_TEMP_LIMIT}
        />
      )}
      {latest.gpu && (
        <LineChart
          title="GPU temperature · peak"
          unit="°C"
          points={series((s) => s.gpuTempMax)}
          min={20}
          max={Math.max(100, GPU_TEMP_LIMIT + 5)}
          limit={GPU_TEMP_LIMIT}
        />
      )}
    </div>
  );
}
