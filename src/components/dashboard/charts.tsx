// Dependency-free SVG charts ported from the design (no recharts).

export function Donut({
  data,
  size = 220,
  thickness = 26,
  centerLabel,
  centerSub,
}: {
  data: { value: number; color: string }[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerSub?: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = (size - thickness) / 2;
  const C = 2 * Math.PI * r;
  // Pre-compute each segment's arc length and its cumulative offset so the
  // render stays free of mutable closure state (react-hooks/immutability).
  const segments = data.map((d, i) => {
    const len = (d.value / total) * C;
    const offset = data.slice(0, i).reduce((s, prev) => s + (prev.value / total) * C, 0);
    return { color: d.color, len, offset };
  });
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: "rotate(-90deg)" }}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={thickness}
        />
        {segments.map((s, i) => (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={thickness}
            strokeDasharray={`${s.len} ${C - s.len}`}
            strokeDashoffset={-s.offset}
          />
        ))}
      </svg>
      {(centerLabel !== undefined || centerSub) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-2 text-center">
          {centerLabel !== undefined && (
            <span className="font-display text-2xl leading-none whitespace-nowrap">
              {centerLabel}
            </span>
          )}
          {centerSub && (
            <span className="text-muted-foreground text-[11px] whitespace-nowrap">{centerSub}</span>
          )}
        </div>
      )}
    </div>
  );
}

export function ChartLegend({
  items,
}: {
  items: { label: string; value: string; color: string }[];
}) {
  return (
    <ul className="space-y-1.5">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-2 text-sm">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full"
            style={{ background: it.color }}
          />
          <span className="min-w-0 flex-1 truncate">{it.label}</span>
          <span className="text-muted-foreground tabular-nums">{it.value}</span>
        </li>
      ))}
    </ul>
  );
}

// Bars with an accessible per-bar title (native tooltip) — no JS charting dep.
export function TrendBars({
  points,
  format,
}: {
  points: { date: string; amount: number; label: string }[];
  format: (n: number) => string;
}) {
  const max = Math.max(1, ...points.map((p) => Math.abs(p.amount)));
  return (
    <div className="flex h-40 items-end gap-1" data-slot="insights-trend">
      {points.map((p) => (
        <div
          key={p.date}
          title={`${p.label}: ${format(p.amount)}`}
          className="bg-primary/70 hover:bg-primary min-w-0 flex-1 rounded-t transition-colors"
          style={{ height: `${Math.max(2, (Math.abs(p.amount) / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

export function MiniBars({
  values,
  width = 380,
  height = 100,
  highlightMax = true,
}: {
  values: number[];
  width?: number;
  height?: number;
  highlightMax?: boolean;
}) {
  const max = Math.max(1, ...values);
  const maxIdx = values.indexOf(Math.max(...values));
  const gap = 1.2;
  const barW = (width - gap * Math.max(1, values.length - 1)) / Math.max(1, values.length);
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {values.map((v, i) => {
        const barH = (v / max) * (height - 4);
        return (
          <rect
            key={i}
            x={i * (barW + gap)}
            y={height - (barH || 1)}
            width={barW}
            height={barH || 1}
            rx={Math.min(barW / 2, 1.5)}
            fill={highlightMax && i === maxIdx ? "var(--foreground)" : "var(--muted-foreground)"}
            opacity={0.85}
          />
        );
      })}
    </svg>
  );
}
