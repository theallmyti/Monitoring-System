import { KeyboardEvent, PointerEvent, useState } from "react";
import { onReveal } from "./reveal";

// Time-series line chart, hand-written SVG. One series, one y-axis (dataviz rules).
// Colours come from CSS classes so they follow the Professional tokens.

export interface Point {
  t: number; // epoch ms
  v: number;
}

const W = 360;
const H = 170;
const PL = 36; // room for y labels
const PR = 10;
const PT = 12;
const PB = 24; // room for x labels

interface Props {
  title: string;
  unit: string;
  points: Point[];
  min: number;
  max: number;
  limit?: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const fmtTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtValue = (v: number, unit: string) => `${Math.round(v * 10) / 10}${unit}`;

export function LineChart({ title, unit, points, min, max, limit }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const n = points.length;

  if (n < 2) {
    return (
      <figure className="chart" onPointerMove={onReveal}>
        <figcaption>{title}</figcaption>
        <p className="chart-empty">Collecting. One sample is stored per minute.</p>
      </figure>
    );
  }

  const t0 = points[0].t;
  const t1 = points[n - 1].t;
  const x = (t: number) => PL + ((t - t0) / Math.max(1, t1 - t0)) * (W - PL - PR);
  const y = (v: number) => PT + (1 - (clamp(v, min, max) - min) / (max - min)) * (H - PT - PB);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(t1).toFixed(1)},${y(min).toFixed(1)} L${x(t0).toFixed(1)},${y(min).toFixed(1)} Z`;

  const last = points[n - 1].v;
  const peak = Math.max(...points.map((p) => p.v));
  const ticksY = [min, (min + max) / 2, max];
  const ticksX = [0, 1 / 3, 2 / 3, 1].map((f) => t0 + f * (t1 - t0));

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < n; i++) {
      if (Math.abs(x(points[i].t) - px) < Math.abs(x(points[best].t) - px)) best = i;
    }
    setHover(best);
  };

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const start = hover ?? n - 1;
      setHover(clamp(start + (e.key === "ArrowRight" ? 1 : -1), 0, n - 1));
    } else if (e.key === "Escape") {
      setHover(null);
    }
  };

  const h = hover !== null ? points[hover] : null;

  return (
    <figure className="chart" onPointerMove={onReveal}>
      <figcaption>
        <span>{title}</span>
        <span className="chart-now">
          latest {fmtValue(last, unit)} · peak {fmtValue(peak, unit)}
        </span>
      </figcaption>

      <div className="chart-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          tabIndex={0}
          aria-label={`${title}. Latest ${fmtValue(last, unit)}, peak ${fmtValue(peak, unit)}. Use arrow keys to read values.`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
        >
          {ticksY.map((tv) => (
            <g key={`y${tv}`}>
              <line className="grid" x1={PL} x2={W - PR} y1={y(tv)} y2={y(tv)} />
              <text className="axis" x={PL - 8} y={y(tv) + 4} textAnchor="end">{Math.round(tv)}</text>
            </g>
          ))}
          {ticksX.map((tt, i) => (
            <text key={`x${i}`} className="axis" x={x(tt)} y={H - 6} textAnchor={i === 0 ? "start" : i === 3 ? "end" : "middle"}>
              {fmtTime(tt)}
            </text>
          ))}

          <path className="area" d={area} />
          <path className="series" d={line} />

          {limit !== undefined && limit >= min && limit <= max && (
            <g>
              <line className="limit" x1={PL} x2={W - PR} y1={y(limit)} y2={y(limit)} />
              <text className="limit-label" x={W - PR} y={y(limit) - 6} textAnchor="end">
                limit {limit}{unit}
              </text>
            </g>
          )}

          {h && (
            <g>
              <line className="crosshair" x1={x(h.t)} x2={x(h.t)} y1={PT} y2={H - PB} />
              <circle className="marker" cx={x(h.t)} cy={y(h.v)} r={5} />
            </g>
          )}
        </svg>

        {h && (
          <div
            className="tooltip"
            style={{ left: `${(x(h.t) / W) * 100}%` }}
            role="status"
          >
            <span className="tip-time">{fmtTime(h.t)}</span>
            <strong className="tip-value">{fmtValue(h.v, unit)}</strong>
          </div>
        )}
      </div>
    </figure>
  );
}
