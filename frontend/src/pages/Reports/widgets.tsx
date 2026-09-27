import { useState } from "react";

// Shared building blocks for the two command pages (sales + inventory).
// One chart, one bar-row, one KPI, one attention row — both pages stay thin
// and every number on screen uses the same formatting.

export function RangePills({
  days,
  onChange,
}: {
  days: number;
  onChange: (days: number) => void;
}) {
  const options = [
    { days: 7, label: "٧ أيام" },
    { days: 30, label: "٣٠ يوم" },
    { days: 90, label: "٩٠ يوم" },
  ];
  return (
    <div className="cmd-pills" role="tablist" aria-label="النطاق الزمني">
      {options.map((o) => (
        <button
          key={o.days}
          role="tab"
          aria-selected={days === o.days}
          className={`cmd-pill${days === o.days ? " active" : ""}`}
          onClick={() => onChange(o.days)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad" | "warn";
}) {
  return (
    <div className="cmd-kpi">
      <span className="cmd-kpi-label">{label}</span>
      <span className={`cmd-kpi-value${tone ? ` tone-${tone}` : ""}`}>{value}</span>
      {sub ? <span className="cmd-kpi-sub">{sub}</span> : null}
    </div>
  );
}

export interface HBarRow {
  label: string;
  sub?: string;
  value: number;
  display: string;
  tone?: string;
}

/** Horizontal distribution bars. Widths are relative to the largest row. */
export function HBars({ rows }: { rows: HBarRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="cmd-empty">لا توجد بيانات في هذا النطاق.</p>;
  return (
    <div className="cmd-hbars">
      {rows.map((r) => (
        <div className="cmd-hbar-row" key={r.label}>
          <div className="cmd-hbar-head">
            <span>{r.label}</span>
            <span className="cmd-hbar-val">{r.display}</span>
          </div>
          <div className="cmd-hbar-track">
            <div
              className="cmd-hbar-fill"
              style={{
                width: `${Math.max(2, (r.value / max) * 100)}%`,
                background: r.tone ?? "var(--accent, #3b82f6)",
              }}
            />
          </div>
          {r.sub ? <span className="cmd-hbar-sub">{r.sub}</span> : null}
        </div>
      ))}
    </div>
  );
}

export interface TrendPoint {
  label: string;
  a: number;
  b?: number;
}

/** Compact SVG area chart with hover readout. `b` draws the second series. */
export function Trend({
  points,
  legend,
  colors,
  formatY,
}: {
  points: TrendPoint[];
  legend: [string, string?];
  colors: [string, string?];
  formatY: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 220;
  const pad = { t: 14, r: 10, b: 26, l: 10 };
  const cw = W - pad.l - pad.r;
  const ch = H - pad.t - pad.b;

  if (!points.length) return <p className="cmd-empty">لا توجد حركة في هذا النطاق.</p>;

  const maxVal = Math.max(1, ...points.flatMap((p) => [p.a, p.b ?? 0]));
  const x = (i: number) => pad.l + (points.length === 1 ? cw / 2 : (i / (points.length - 1)) * cw);
  const y = (v: number) => pad.t + ch - (v / maxVal) * ch;

  const line = (key: "a" | "b") =>
    points
      .map((p, i) => {
        const v = key === "a" ? p.a : (p.b ?? 0);
        return `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
      })
      .join(" ");
  const area = (key: "a" | "b") =>
    `${line(key)} L ${x(points.length - 1).toFixed(1)} ${pad.t + ch} L ${x(0).toFixed(1)} ${pad.t + ch} Z`;

  const tickIdx = points.length > 1 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : [0];

  return (
    <div className="cmd-trend">
      <div className="cmd-legend">
        <span>
          <i style={{ background: colors[0] }} /> {legend[0]}
        </span>
        {legend[1] ? (
          <span>
            <i style={{ background: colors[1] }} /> {legend[1]}
          </span>
        ) : null}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="cmd-trend-svg"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const sx = ((e.clientX - rect.left) / rect.width) * W;
          let best = 0;
          let dist = Infinity;
          points.forEach((_, i) => {
            const d = Math.abs(x(i) - sx);
            if (d < dist) {
              dist = d;
              best = i;
            }
          });
          setHover(best);
        }}
        onMouseLeave={() => setHover(null)}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={pad.l}
            x2={W - pad.r}
            y1={pad.t + ch * f}
            y2={pad.t + ch * f}
            className="cmd-grid"
          />
        ))}
        <path d={area("a")} fill={colors[0]} opacity={0.14} />
        {legend[1] ? <path d={area("b")} fill={colors[1]!} opacity={0.1} /> : null}
        <path d={line("a")} fill="none" stroke={colors[0]} strokeWidth={2.5} strokeLinejoin="round" />
        {legend[1] ? (
          <path
            d={line("b")}
            fill="none"
            stroke={colors[1]!}
            strokeWidth={2}
            strokeDasharray="5 4"
            strokeLinejoin="round"
          />
        ) : null}
        {tickIdx.map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="cmd-tick">
            {points[i].label}
          </text>
        ))}
        {hover !== null ? (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ch} className="cmd-hover-line" />
            <circle cx={x(hover)} cy={y(points[hover].a)} r={4} fill={colors[0]} stroke="var(--color-accent-contrast)" strokeWidth={2} />
            {legend[1] && points[hover].b !== undefined ? (
              <circle
                cx={x(hover)}
                cy={y(points[hover].b!)}
                r={4}
                fill={colors[1]!}
                stroke="var(--color-accent-contrast)"
                strokeWidth={2}
              />
            ) : null}
          </g>
        ) : null}
      </svg>
      <div className="cmd-tip" aria-live="polite">
        {hover !== null ? (
          <>
            <strong>{points[hover].label}</strong>
            <span>
              {legend[0]}: {formatY(points[hover].a)}
            </span>
            {legend[1] && points[hover].b !== undefined ? (
              <span>
                {legend[1]}: {formatY(points[hover].b!)}
              </span>
            ) : null}
          </>
        ) : (
          <span className="cmd-tip-hint">مرر المؤشر فوق الرسم لرؤية القيم</span>
        )}
      </div>
    </div>
  );
}

export function AttentionRow({
  title,
  count,
  sub,
  to,
  navigate,
  tone,
}: {
  title: string;
  count: string;
  sub?: string;
  to?: string;
  navigate: (path: string) => void;
  tone?: "bad" | "warn";
}) {
  const body = (
    <>
      <div>
        <div className="cmd-att-title">{title}</div>
        {sub ? <div className="cmd-att-sub">{sub}</div> : null}
      </div>
      <span className={`cmd-att-count${tone ? ` tone-${tone}` : ""}`}>{count}</span>
    </>
  );
  return to ? (
    <button className="cmd-att-row link" onClick={() => navigate(to)}>
      {body}
      <span className="cmd-att-arrow">‹</span>
    </button>
  ) : (
    <div className="cmd-att-row">{body}</div>
  );
}

export function Panel({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="cmd-panel">
      <div className="cmd-panel-head">
        <h2>{title}</h2>
        {sub ? <p>{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function Skeleton() {
  return (
    <div className="cmd-grid-kpi" aria-label="جاري التحميل">
      {Array.from({ length: 4 }).map((_, i) => (
        <div className="cmd-skeleton" key={i} />
      ))}
    </div>
  );
}
