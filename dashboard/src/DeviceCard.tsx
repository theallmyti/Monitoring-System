import { useEffect, useState } from "react";
import { Device } from "./types";

// Default alert thresholds from docs/PRD.md §5.
const CPU_TEMP_LIMIT = 90;
const GPU_TEMP_LIMIT = 85;
const RAM_LIMIT = 90;

function Reading({ label, value, unit = "%", limit, percent }: {
  label: string;
  value: number;
  unit?: string;
  limit?: number;
  percent?: number;
}) {
  const hot = limit !== undefined && value >= limit;
  const width = Math.max(0, Math.min(100, percent ?? value));
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd>
        <div className={`bar ${hot ? "hot" : ""}`} role="img" aria-label={`${label} ${value.toFixed(0)}${unit}`}>
          <div className="fill" style={{ width: `${width}%` }} />
        </div>
      </dd>
      <span className="value">{value.toFixed(unit === "%" ? 0 : 1)}{unit}</span>
    </div>
  );
}

export function DeviceCard({ device }: { device: Device }) {
  // Re-render every second so "last update" stays current.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const l = device.latest;
  const ageSec = Math.max(0, Math.round((Date.now() - device.lastSeenAt) / 1000));
  const age = ageSec < 120 ? `${ageSec} s ago` : `${Math.round(ageSec / 60)} min ago`;

  return (
    <section className="entry" aria-labelledby={`dev-${device.id}`}>
      <div className="entry-head">
        <h2 id={`dev-${device.id}`}>{device.name}</h2>
        <p className="status">{device.online ? "Online" : "Offline"} · last update {age}</p>
      </div>

      {!l ? (
        <p className="empty">No readings yet.</p>
      ) : (
        <div>
          <dl className="metrics">
            <Reading label="CPU use" value={l.cpu.util} />
            {l.cpu.packageTemp !== undefined ? (
              <Reading label="CPU temperature" value={l.cpu.packageTemp} unit="°C" limit={CPU_TEMP_LIMIT} percent={(l.cpu.packageTemp / CPU_TEMP_LIMIT) * 100} />
            ) : (
              <div className="metric"><dt>CPU temperature</dt><dd className="none">no sensor</dd><span /></div>
            )}
            <Reading label="RAM" value={l.ram.usedPct} limit={RAM_LIMIT} />
            {l.gpu && (
              <>
                <Reading label="GPU temperature" value={l.gpu.temp} unit="°C" limit={GPU_TEMP_LIMIT} percent={(l.gpu.temp / GPU_TEMP_LIMIT) * 100} />
                <Reading label="GPU use" value={l.gpu.util} />
                <Reading label="VRAM" value={(l.gpu.vramUsed / l.gpu.vramTotal) * 100} />
              </>
            )}
          </dl>

          {l.gpu && (
            <p className="gpu">
              {l.gpu.powerW.toFixed(1)} W · {l.gpu.clock} MHz
              {l.gpu.fanPct !== undefined ? ` · fan ${l.gpu.fanPct}%` : ""}
            </p>
          )}
          {l.pi?.docker && (
            <p className="containers">
              Containers: {l.pi.docker.running} running, {l.pi.docker.stopped} stopped,{" "}
              <span className={l.pi.docker.errored > 0 ? "err" : ""}>{l.pi.docker.errored} errored</span>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
