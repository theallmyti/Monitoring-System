import { onReveal } from "./reveal";
// KPI tile: label, large number, a thin meter, and a short note.
export function Kpi({
  label,
  value,
  unit = "",
  note,
  meter,
  hot = false,
}: {
  label: string;
  value: string | number;
  unit?: string;
  note?: string;
  meter?: number; // 0..100
  hot?: boolean;
}) {
  return (
    <div className={`kpi ${hot ? "kpi-hot" : ""}`} onPointerMove={onReveal}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">
        {value}
        {unit && <span className="kpi-unit">{unit}</span>}
      </span>
      {meter !== undefined && (
        <div className="meter" role="img" aria-label={`${label} ${Math.round(meter)} percent of the scale`}>
          <div className="meter-fill" style={{ width: `${Math.max(0, Math.min(100, meter))}%` }} />
        </div>
      )}
      {note && <span className="kpi-note">{note}</span>}
    </div>
  );
}
