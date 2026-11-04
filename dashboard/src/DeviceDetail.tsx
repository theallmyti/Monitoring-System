import { ReactNode } from "react";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { Device, RANGES, Range } from "./types";
import { Kpi } from "./Kpi";
import { DeviceStatus } from "./DeviceSection";
import { CPU_TEMP_LIMIT, GPU_TEMP_LIMIT, HistoryCharts, RAM_LIMIT, useHistory } from "./History";
import { avg, fmtGB, fmtUptime, usedPct } from "./format";

// Everything one device reports (FR-20–FR-26). Per-core, RAM detail and processes arrive only
// while a page is open, so they appear a second or two after opening.
export function DeviceDetail({
  device,
  token,
  range,
  onRange,
  onBack,
}: {
  device: Device;
  token: string;
  range: Range;
  onRange: (r: Range) => void;
  onBack: () => void;
}) {
  const history = useHistory(token, device.id, range);
  const removeDevice = useMutation(anyApi.dashboard.removeDevice);
  const l = device.latest;
  const caps = device.capabilities;

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div>
            <button type="button" className="back" onClick={onBack}>
              ‹ All devices
            </button>
            <h1>{device.name}</h1>
            <DeviceStatus device={device} />
          </div>
          <div className="segmented" role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button
                key={r.label}
                type="button"
                aria-pressed={r.hours === range.hours}
                className={r.hours === range.hours ? "on" : ""}
                onClick={() => onRange(r)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="page">
        <Facts device={device} />
        {!l ? (
          <p className="empty">No readings yet.</p>
        ) : (
          <>
            <Processor device={device} />
            <Memory device={device} />
            {l.gpu && <Graphics device={device} />}
            <Storage device={device} />
            {l.battery && <Battery device={device} />}
            <Section title="History">
              <HistoryCharts history={history} latest={l} />
            </Section>
          </>
        )}
        {caps?.windowsMode === "noDriver" && (
          <p className="muted small note">
            CPU temperature needs the PawnIO driver: run the installer again with “Show CPU temperature” ticked.
          </p>
        )}
        <div className="danger">
          <button
            type="button"
            className="link"
            onClick={() => {
              if (
                window.confirm(
                  `Remove ${device.name}? Its history is deleted, and it stops sending data until it is paired again.`,
                )
              ) {
                void removeDevice({ token, deviceId: device.id }).then(onBack);
              }
            }}
          >
            Remove this device
          </button>
        </div>
      </main>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="detail-section" aria-label={title}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Facts({ device }: { device: Device }) {
  const caps = device.capabilities;
  const l = device.latest;
  const facts = [
    caps?.cpuModel,
    l?.ram.detail && `${Math.round(l.ram.detail.total)} GB RAM${caps?.ramSpeedMTs ? ` · ${caps.ramSpeedMTs} MT/s` : ""}`,
    l?.uptimeSec !== undefined && `up ${fmtUptime(l.uptimeSec)}`,
  ].filter(Boolean);
  return facts.length ? <p className="facts">{facts.join(" · ")}</p> : null;
}

function Processor({ device }: { device: Device }) {
  const { cpu } = device.latest!;
  const clockAvg = avg(cpu.clocks);
  const clockMax = cpu.clocks?.length ? Math.max(...cpu.clocks) : undefined;
  return (
    <Section title="Processor">
      <div className="kpis">
        <Kpi label="Use" value={Math.round(cpu.util)} unit="%" meter={cpu.util} />
        <Kpi
          label="Speed · average"
          value={clockAvg !== undefined ? (clockAvg / 1000).toFixed(2) : "…"}
          unit={clockAvg !== undefined ? "GHz" : ""}
          note={clockMax !== undefined ? `fastest core ${(clockMax / 1000).toFixed(2)} GHz` : "appears while this page is open"}
        />
        {cpu.packageTemp !== undefined ? (
          <Kpi
            label="Temperature"
            value={cpu.packageTemp.toFixed(1)}
            unit="°C"
            note={`limit ${CPU_TEMP_LIMIT} °C`}
            meter={(cpu.packageTemp / CPU_TEMP_LIMIT) * 100}
            hot={cpu.packageTemp >= CPU_TEMP_LIMIT}
          />
        ) : (
          <Kpi label="Temperature" value="n/a" note="no sensor on this device" />
        )}
        <Kpi label="Cores" value={cpu.perCoreUtil?.length ?? "…"} note="logical processors" />
      </div>
      {cpu.perCoreUtil && (
        <ul className="cores" aria-label="Use and speed per core">
          {cpu.perCoreUtil.map((u, i) => (
            <li key={i} className="core">
              <span className="core-name">Core {i + 1}</span>
              <span className="core-value">{Math.round(u)}%</span>
              <div className="meter" aria-hidden="true">
                <div className="meter-fill" style={{ width: `${Math.max(0, Math.min(100, u))}%` }} />
              </div>
              {cpu.clocks?.[i] !== undefined && (
                <span className="core-clock">{(cpu.clocks[i] / 1000).toFixed(2)} GHz</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Memory({ device }: { device: Device }) {
  const { ram } = device.latest!;
  const speed = device.capabilities?.ramSpeedMTs;
  const d = ram.detail;
  const maxMb = Math.max(1, ...(ram.topProcs ?? []).map((p) => p.mb));
  return (
    <Section title="Memory">
      <div className="kpis">
        <Kpi
          label="In use"
          value={d ? d.used.toFixed(1) : Math.round(ram.usedPct)}
          unit={d ? `of ${d.total.toFixed(1)} GB` : "%"}
          note={`${Math.round(ram.usedPct)} % · limit ${RAM_LIMIT} %`}
          meter={ram.usedPct}
          hot={ram.usedPct >= RAM_LIMIT}
        />
        <Kpi label="Speed" value={speed ?? "n/a"} unit={speed ? "MT/s" : ""} note={speed ? undefined : "not reported on this device"} />
        {d && <Kpi label="Free" value={d.free.toFixed(1)} unit="GB" />}
        {d && d.swapTotal > 0 && (
          <Kpi
            label="Page file / swap"
            value={d.swapUsed.toFixed(1)}
            unit={`of ${d.swapTotal.toFixed(1)} GB`}
            meter={(d.swapUsed / d.swapTotal) * 100}
          />
        )}
      </div>
      {ram.topProcs && ram.topProcs.length > 0 && (
        <div className="list-card">
          <span className="kpi-label">Top processes by memory</span>
          <ul className="bars">
            {ram.topProcs.map((p) => (
              <li key={p.name}>
                <span className="bar-name">{p.name}</span>
                <span className="bar-value">{p.mb >= 1024 ? `${(p.mb / 1024).toFixed(1)} GB` : `${Math.round(p.mb)} MB`}</span>
                <div className="meter" aria-hidden="true">
                  <div className="meter-fill" style={{ width: `${(p.mb / maxMb) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

function Graphics({ device }: { device: Device }) {
  const g = device.latest!.gpu!;
  const vram = g.vramTotal > 0 ? (g.vramUsed / g.vramTotal) * 100 : 0;
  return (
    <Section title="Graphics">
      <div className="kpis">
        <Kpi
          label="Temperature"
          value={g.temp.toFixed(0)}
          unit="°C"
          note={`limit ${GPU_TEMP_LIMIT} °C`}
          meter={(g.temp / GPU_TEMP_LIMIT) * 100}
          hot={g.temp >= GPU_TEMP_LIMIT}
        />
        <Kpi label="Use" value={Math.round(g.util)} unit="%" meter={g.util} />
        <Kpi label="Speed" value={Math.round(g.clock)} unit="MHz" note="graphics clock" />
        <Kpi label="Power" value={g.powerW.toFixed(1)} unit="W" />
        <Kpi label="VRAM" value={Math.round(vram)} unit="%" note={`${Math.round(g.vramUsed)} of ${Math.round(g.vramTotal)} MB`} meter={vram} />
        <Kpi label="Fan" value={g.fanPct !== undefined ? Math.round(g.fanPct) : "n/a"} unit={g.fanPct !== undefined ? "%" : ""} note={g.fanPct === undefined ? "laptop GPUs often do not report it" : undefined} />
      </div>
    </Section>
  );
}

function Storage({ device }: { device: Device }) {
  const live = device.latest?.disks;
  const known = device.capabilities?.drives ?? [];
  if (!live?.length && !known.length) return null;
  return (
    <Section title="Storage">
      <ul className="drives">
        {live?.length
          ? live.map((d) => (
              <li key={d.name} className={`drive ${d.freeGB / d.totalGB < 0.1 ? "kpi-hot" : ""}`}>
                <span className="bar-name">{d.name}</span>
                <span className="bar-value">
                  {fmtGB(d.totalGB - d.freeGB)} used of {fmtGB(d.totalGB)} · {fmtGB(d.freeGB)} free
                </span>
                <div className="meter" role="img" aria-label={`${d.name} ${Math.round(usedPct(d))} percent used`}>
                  <div className="meter-fill" style={{ width: `${usedPct(d)}%` }} />
                </div>
              </li>
            ))
          : known.map((d) => (
              <li key={d.name} className="drive">
                <span className="bar-name">{d.name}</span>
                <span className="bar-value">{fmtGB(d.totalGB)} · free space appears while this page is open</span>
              </li>
            ))}
      </ul>
    </Section>
  );
}

function Battery({ device }: { device: Device }) {
  const b = device.latest!.battery!;
  return (
    <Section title="Battery">
      <div className="kpis">
        <Kpi label="Charge" value={Math.round(b.pct)} unit="%" meter={b.pct} hot={!b.charging && b.pct < 15} />
        <Kpi
          label={b.charging ? "Charging" : "On battery"}
          value={b.rateW !== undefined ? b.rateW.toFixed(1) : "—"}
          unit={b.rateW !== undefined ? "W" : ""}
          note={b.charging ? "charge rate" : "power draw"}
        />
        {b.healthPct !== undefined && <Kpi label="Health" value={Math.round(b.healthPct)} unit="%" note="of design capacity" meter={b.healthPct} />}
        {b.cycles !== undefined && <Kpi label="Cycles" value={b.cycles} />}
      </div>
    </Section>
  );
}
