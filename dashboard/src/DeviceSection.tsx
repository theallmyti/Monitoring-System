import { Device } from "./types";
import { Kpi } from "./Kpi";
import { CPU_TEMP_LIMIT, GPU_TEMP_LIMIT, RAM_LIMIT } from "./History";
import { fmtGB, fmtUptime, fullestDrive, lastUpdateText, usedPct } from "./format";

export { CPU_TEMP_LIMIT, GPU_TEMP_LIMIT, RAM_LIMIT };

// Online dot, last update, agent version and update notice.
export function DeviceStatus({ device }: { device: Device }) {
  return (
    <p className="status">
      <span className={`dot ${device.online ? "on" : "off"}`} aria-hidden="true" />
      {device.online ? "Online" : "Offline"} · last update {lastUpdateText(device)}
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
  );
}

// Short card on the dashboard; every other stat is on the device page (Details).
export function DeviceSection({ device, onOpen }: { device: Device; onOpen: () => void }) {
  const l = device.latest;
  const drive = fullestDrive(l?.disks);

  return (
    <section className="device" aria-labelledby={`dev-${device.id}`}>
      <header className="device-head">
        <div>
          <h2 id={`dev-${device.id}`}>{device.name}</h2>
          <DeviceStatus device={device} />
        </div>
        <button type="button" className="link" onClick={onOpen} aria-label={`Details for ${device.name}`}>
          Details
        </button>
      </header>

      {!l ? (
        <p className="chart-empty">No readings yet.</p>
      ) : (
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
          <Kpi
            label="RAM"
            value={Math.round(l.ram.usedPct)}
            unit="%"
            note={l.ram.detail ? `${l.ram.detail.used.toFixed(1)} of ${l.ram.detail.total.toFixed(1)} GB` : `limit ${RAM_LIMIT} %`}
            meter={l.ram.usedPct}
            hot={l.ram.usedPct >= RAM_LIMIT}
          />
          {l.gpu && (
            <Kpi
              label="GPU temperature"
              value={l.gpu.temp.toFixed(0)}
              unit="°C"
              note={`limit ${GPU_TEMP_LIMIT} °C`}
              meter={(l.gpu.temp / GPU_TEMP_LIMIT) * 100}
              hot={l.gpu.temp >= GPU_TEMP_LIMIT}
            />
          )}
          {drive && (
            <Kpi
              label={`Storage ${drive.name}`}
              value={Math.round(usedPct(drive))}
              unit="% used"
              note={`${fmtGB(drive.freeGB)} free of ${fmtGB(drive.totalGB)}`}
              meter={usedPct(drive)}
              hot={drive.freeGB / drive.totalGB < 0.1}
            />
          )}
          {l.uptimeSec !== undefined && <Kpi label="Uptime" value={fmtUptime(l.uptimeSec)} />}
          {l.battery && (
            <Kpi
              label="Battery"
              value={Math.round(l.battery.pct)}
              unit="%"
              note={l.battery.charging ? "charging" : "on battery"}
              meter={l.battery.pct}
              hot={!l.battery.charging && l.battery.pct < 15}
            />
          )}
        </div>
      )}
    </section>
  );
}
