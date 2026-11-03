import { useState } from "react";
import { useQuery } from "convex/react";
import { anyApi } from "convex/server";
import { Device, Overview, RANGES, Range } from "./types";
import { DeviceSection, CPU_TEMP_LIMIT, GPU_TEMP_LIMIT, RAM_LIMIT } from "./DeviceSection";
import { Kpi } from "./Kpi";
import { Backdrop } from "./Backdrop";

// Owner-only read token. Kept in this browser's localStorage (per-viewer convenience).
const TOKEN_KEY = "pcm-read-token";

export default function App() {
  const [token, setToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  });

  if (!token) {
    return (
      <TokenScreen
        onSave={(t) => {
          try {
            localStorage.setItem(TOKEN_KEY, t);
          } catch {
            /* private window: keep the token in memory only */
          }
          setToken(t);
        }}
      />
    );
  }
  return (
    <Dashboard
      token={token}
      onSignOut={() => {
        try {
          localStorage.removeItem(TOKEN_KEY);
        } catch {
          /* ignore */
        }
        setToken(null);
      }}
    />
  );
}

function TokenScreen({ onSave }: { onSave: (t: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <main className="center">
      <form
        className="login"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSave(value.trim());
        }}
      >
        <h1>PC Monitor</h1>
        <label>
          Dashboard read token
          <input type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <button type="submit" className="action">Open dashboard</button>
      </form>
    </main>
  );
}

function Dashboard({ token, onSignOut }: { token: string; onSignOut: () => void }) {
  const [range, setRange] = useState<Range>(RANGES[0]);
  const data = useQuery(anyApi.dashboard.overview, { token }) as Overview | undefined;

  if (data === undefined) {
    return (
      <main className="center">
        <p className="empty">Loading readings…</p>
      </main>
    );
  }

  const devices = data.devices;
  const online = devices.filter((d) => d.online).length;
  // Fleet tiles use live devices only; an offline device's last readings are stale.
  const withLatest = devices.filter((d) => d.latest && d.online);
  const hottestCpu = pickMax(withLatest, (d) => d.latest?.cpu.packageTemp);
  const highestRam = pickMax(withLatest, (d) => d.latest?.ram.usedPct);
  const hottestGpu = pickMax(withLatest, (d) => d.latest?.gpu?.temp);
  const errored = withLatest.reduce((n, d) => n + (d.latest?.pi?.docker?.errored ?? 0), 0);
  const running = withLatest.reduce((n, d) => n + (d.latest?.pi?.docker?.running ?? 0), 0);

  return (
    <>
      <Backdrop />
      <header className="topbar">
        <div className="topbar-inner">
        <div>
          <h1>PC Monitor</h1>
          <p className="italic">Every machine you own, at a glance.</p>
        </div>
        <div className="topbar-actions">
          <div className="segmented" role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button
                key={r.label}
                type="button"
                aria-pressed={r.hours === range.hours}
                className={r.hours === range.hours ? "on" : ""}
                onClick={() => setRange(r)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button type="button" className="link" onClick={onSignOut}>Sign out</button>
        </div>
        </div>
      </header>

      <main className="page">

      {devices.length === 0 ? (
        <p className="empty">No devices have reported yet.</p>
      ) : (
        <>
          <section className="fleet" aria-label="Fleet summary">
            <Kpi label="Devices online" value={`${online} of ${devices.length}`} hot={online < devices.length} />
            <Kpi
              label="Hottest CPU"
              value={hottestCpu ? hottestCpu.value.toFixed(1) : "n/a"}
              unit={hottestCpu ? "°C" : ""}
              note={hottestCpu ? `${hottestCpu.name} · limit ${CPU_TEMP_LIMIT} °C` : "no CPU sensors"}
              meter={hottestCpu ? (hottestCpu.value / CPU_TEMP_LIMIT) * 100 : undefined}
              hot={hottestCpu ? hottestCpu.value >= CPU_TEMP_LIMIT : false}
            />
            <Kpi
              label="Highest RAM"
              value={highestRam ? Math.round(highestRam.value) : "n/a"}
              unit={highestRam ? "%" : ""}
              note={highestRam ? `${highestRam.name} · limit ${RAM_LIMIT} %` : undefined}
              meter={highestRam?.value}
              hot={highestRam ? highestRam.value >= RAM_LIMIT : false}
            />
            <Kpi
              label="Hottest GPU"
              value={hottestGpu ? Math.round(hottestGpu.value) : "n/a"}
              unit={hottestGpu ? "°C" : ""}
              note={hottestGpu ? `${hottestGpu.name} · limit ${GPU_TEMP_LIMIT} °C` : "no NVIDIA GPU"}
              meter={hottestGpu ? (hottestGpu.value / GPU_TEMP_LIMIT) * 100 : undefined}
              hot={hottestGpu ? hottestGpu.value >= GPU_TEMP_LIMIT : false}
            />
            <Kpi
              label="Containers"
              value={running + errored > 0 ? running : "n/a"}
              unit={running + errored > 0 ? "running" : ""}
              note={running + errored > 0 ? `${errored} errored` : "no Docker host"}
              hot={errored > 0}
            />
          </section>

          {devices.map((d) => (
            <DeviceSection key={d.id} device={d} token={token} range={range} />
          ))}
        </>
      )}
    </main>
    </>
  );
}

function pickMax(devices: Device[], pick: (d: Device) => number | undefined) {
  let best: { name: string; value: number } | null = null;
  for (const d of devices) {
    const v = pick(d);
    if (v !== undefined && (best === null || v > best.value)) best = { name: d.name, value: v };
  }
  return best;
}
