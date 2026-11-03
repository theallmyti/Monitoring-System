import { useEffect, useState } from "react";
import { Device } from "./types";

// Default alert thresholds from docs/PRD.md §5.
const CPU_TEMP_LIMIT = 90;
const GPU_TEMP_LIMIT = 85;
const RAM_LIMIT = 90;

function Bar({ value, limit, unit = "%" }: { value: number; limit?: number; unit?: string }) {
  const hot = limit !== undefined && value >= limit;
  const pct = Math.max(0, Math.min(100, unit === "%" ? value : (value / (limit ?? 100)) * 100));
  return (
    <div className={`bar ${hot ? "hot" : ""}`}>
      <div className="fill" style={{ width: `${pct}%` }} />
      <span>{value.toFixed(unit === "%" ? 0 : 1)}{unit}</span>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      {children}
    </div>
  );
}

export function DeviceCard({ device }: { device: Device }) {
  // Re-render every second so "last seen" stays current.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const l = device.latest;
  const ageSec = Math.max(0, Math.round((Date.now() - device.lastSeenAt) / 1000));

  return (
    <article className="card">
      <header className="card-head">
        <h2>{device.name}</h2>
        <span className={`badge ${device.online ? "on" : "off"}`}>{device.online ? "Online" : "Offline"}</span>
      </header>
      <p className="muted small">Last update {ageSec < 120 ? `${ageSec}s ago` : `${Math.round(ageSec / 60)} min ago`}</p>

      {!l ? (
        <p className="muted">No data yet.</p>
      ) : (
        <>
          <Stat label="CPU">
            <Bar value={l.cpu.util} />
          </Stat>
          <Stat label="CPU temperature">
            {l.cpu.packageTemp !== undefined ? (
              <Bar value={l.cpu.packageTemp} limit={CPU_TEMP_LIMIT} unit="°C" />
            ) : (
              <span className="muted">no sensor</span>
            )}
          </Stat>
          <Stat label="RAM">
            <Bar value={l.ram.usedPct} limit={RAM_LIMIT} />
          </Stat>
          {l.gpu && (
            <>
              <Stat label="GPU temperature">
                <Bar value={l.gpu.temp} limit={GPU_TEMP_LIMIT} unit="°C" />
              </Stat>
              <Stat label="GPU load">
                <Bar value={l.gpu.util} />
              </Stat>
              <Stat label="VRAM">
                <Bar value={(l.gpu.vramUsed / l.gpu.vramTotal) * 100} />
              </Stat>
              <p className="small muted">
                {l.gpu.powerW.toFixed(1)} W · {l.gpu.clock} MHz
                {l.gpu.fanPct !== undefined ? ` · fan ${l.gpu.fanPct}%` : ""}
              </p>
            </>
          )}
          {l.pi?.docker && (
            <p className="small">
              Containers: <b>{l.pi.docker.running}</b> running · {l.pi.docker.stopped} stopped ·{" "}
              <span className={l.pi.docker.errored > 0 ? "err" : ""}>{l.pi.docker.errored} errored</span>
            </p>
          )}
        </>
      )}
    </article>
  );
}
