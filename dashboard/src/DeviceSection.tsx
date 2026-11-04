import { useMutation, useQuery } from "convex/react";
import { anyApi } from "convex/server";
import { Device } from "./types";
import { Summary, Range } from "./types";
import { LineChart, Point } from "./LineChart";
import { Kpi } from "./Kpi";

// Default alert thresholds from docs/PRD.md §5.
export const CPU_TEMP_LIMIT = 90;
export const GPU_TEMP_LIMIT = 85;
export const RAM_LIMIT = 90;

const MINUTE = 60_000;

export function DeviceSection({ device, token, range }: { device: Device; token: string; range: Range }) {
  // Floor to the minute so the query arguments only change once a minute, not every second.
  const sinceMs = Math.floor(Date.now() / MINUTE) * MINUTE - range.hours * 3_600_000;
  const history = useQuery(anyApi.dashboard.history, {
    token,
    deviceId: device.id,
    sinceMs,
  }) as Summary[] | undefined;

  const l = device.latest;
  const series = (pick: (s: Summary) => number | undefined): Point[] =>
    (history ?? []).flatMap((s) => {
      const v = pick(s);
      return v === undefined ? [] : [{ t: s.minuteTs, v }];
    });

  const ageSec = Math.max(0, Math.round((Date.now() - device.lastSeenAt) / 1000));
  const age = ageSec < 120 ? `${ageSec} s ago` : `${Math.round(ageSec / 60)} min ago`;
  const vram = l?.gpu ? (l.gpu.vramUsed / l.gpu.vramTotal) * 100 : undefined;
  const removeDevice = useMutation(anyApi.dashboard.removeDevice);

  return (
    <section className="device" aria-labelledby={`dev-${device.id}`}>
      <header className="device-head">
        <div>
          <h2 id={`dev-${device.id}`}>{device.name}</h2>
          <p className="status">
            <span className={`dot ${device.online ? "on" : "off"}`} aria-hidden="true" />
            {device.online ? "Online" : "Offline"} · last update {age}
            {device.agentVersion && ` · agent ${device.agentVersion}`}
            {device.updateAvailable && (
              <>
                {" · "}
                <a href="https://github.com/theallmyti/Monitoring-System/releases" target="_blank" rel="noreferrer">
                  update available
                </a>
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          className="link"
          onClick={() => {
            if (
              window.confirm(
                `Remove ${device.name}? Its history is deleted, and it stops sending data until it is paired again.`,
              )
            ) {
              void removeDevice({ token, deviceId: device.id });
            }
          }}
        >
          Remove
        </button>
      </header>

      {!l ? (
        <p className="chart-empty">No readings yet.</p>
      ) : (
        <>
          <div className="kpis">
            <Kpi label="CPU use" value={Math.round(l.cpu.util)} unit="%" meter={l.cpu.util} />
            {l.cpu.packageTemp !== undefined ? (
              <Kpi
                label="CPU temperature"
                value={l.cpu.packageTemp.toFixed(1)}
                unit="°C"
                note={`limit ${CPU_TEMP_LIMIT} °C`}
                meter={(l.cpu.packageTemp / CPU_TEMP_LIMIT) * 100}
                hot={l.cpu.packageTemp >= CPU_TEMP_LIMIT}
              />
            ) : (
              <Kpi label="CPU temperature" value="n/a" note="no sensor on this device" />
            )}
            <Kpi label="RAM" value={Math.round(l.ram.usedPct)} unit="%" note={`limit ${RAM_LIMIT} %`} meter={l.ram.usedPct} hot={l.ram.usedPct >= RAM_LIMIT} />
            {l.gpu && (
              <>
                <Kpi
                  label="GPU temperature"
                  value={l.gpu.temp.toFixed(0)}
                  unit="°C"
                  note={`limit ${GPU_TEMP_LIMIT} °C`}
                  meter={(l.gpu.temp / GPU_TEMP_LIMIT) * 100}
                  hot={l.gpu.temp >= GPU_TEMP_LIMIT}
                />
                <Kpi label="GPU use" value={Math.round(l.gpu.util)} unit="%" meter={l.gpu.util} />
                <Kpi
                  label="VRAM"
                  value={Math.round(vram ?? 0)}
                  unit="%"
                  note={`${Math.round(l.gpu.vramUsed)} of ${Math.round(l.gpu.vramTotal)} MB`}
                  meter={vram}
                />
              </>
            )}
          </div>

          <div className="charts">
            <LineChart title="CPU use · avg" unit="%" points={series((s) => s.cpuUtilAvg)} min={0} max={100} />
            <LineChart title="RAM · avg" unit="%" points={series((s) => s.ramPctAvg)} min={0} max={100} limit={RAM_LIMIT} />
            {l.cpu.packageTemp !== undefined && (
              <LineChart
                title="CPU temperature · peak"
                unit="°C"
                points={series((s) => s.cpuTempMax)}
                min={20}
                max={Math.max(100, CPU_TEMP_LIMIT + 5)}
                limit={CPU_TEMP_LIMIT}
              />
            )}
            {l.gpu && (
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

          {l.pi?.docker && <Containers counts={l.pi.docker} />}
        </>
      )}
    </section>
  );
}

function Containers({ counts }: { counts: { running: number; stopped: number; errored: number } }) {
  const total = counts.running + counts.stopped + counts.errored || 1;
  const parts: { key: string; n: number; label: string }[] = [
    { key: "running", n: counts.running, label: "running" },
    { key: "stopped", n: counts.stopped, label: "stopped" },
    { key: "errored", n: counts.errored, label: "errored" },
  ];
  return (
    <div className="containers">
      <span className="kpi-label">Containers</span>
      <div
        className="segbar"
        role="img"
        aria-label={`${counts.running} running, ${counts.stopped} stopped, ${counts.errored} errored`}
      >
        {parts.map((p) => (
          <div key={p.key} className={`seg seg-${p.key}`} style={{ width: `${(p.n / total) * 100}%` }} />
        ))}
      </div>
      <ul className="legend">
        {parts.map((p) => (
          <li key={p.key}>
            <span className={`swatch seg-${p.key}`} aria-hidden="true" />
            {p.n} {p.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
