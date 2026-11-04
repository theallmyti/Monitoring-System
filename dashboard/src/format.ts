// Number formatting shared by the device card and the device page.
import { Device, Drive } from "./types";

export function fmtUptime(sec: number) {
  const d = Math.floor(sec / 86_400);
  const h = Math.floor((sec % 86_400) / 3_600);
  const m = Math.floor((sec % 3_600) / 60);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

export const fmtGB = (gb: number) => (gb >= 1000 ? `${(gb / 1000).toFixed(1)} TB` : `${Math.round(gb)} GB`);

export const usedPct = (d: Drive) => (d.totalGB > 0 ? ((d.totalGB - d.freeGB) / d.totalGB) * 100 : 0);

// The drive closest to full: the one worth showing on the card.
export function fullestDrive(drives: Drive[] | undefined) {
  return (drives ?? []).reduce<Drive | undefined>((a, d) => (!a || usedPct(d) > usedPct(a) ? d : a), undefined);
}

export function avg(values: number[] | undefined) {
  return values && values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined;
}

export function lastUpdateText(device: Device) {
  // Newest of the live reading (every second while a page is open) and the minute summary.
  const last = Math.max(device.lastSeenAt, device.latest?.ts ?? 0);
  const sec = Math.max(0, Math.round((Date.now() - last) / 1000));
  return sec < 120 ? `${sec} s ago` : `${Math.round(sec / 60)} min ago`;
}
