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
            style={{ stroke: s.color }}
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

// Cumulative curves: `current` may stop before `reference` (today, while in progress).
export function PaceChart({
  current,
  reference,
  buckets,
  tips,
  axis,
  marker,
  width = 380,
  height = 120,
}: {
  current: number[];
  reference: number[] | null;
  buckets: number;
  // Native tooltip per bucket.
  tips: string[];
  axis: [string, string];
  marker: boolean;
  width?: number;
  height?: number;
}) {
  const max = Math.max(1, ...current, ...(reference ?? []));
  const x = (i: number) => (buckets > 1 ? (i / (buckets - 1)) * width : width / 2);
  const y = (v: number) => height - 2 - (v / max) * (height - 6);
  const path = (values: number[]) =>
    values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = current.length - 1;
  const slot = width / Math.max(1, buckets);
  return (
    <div className="space-y-1.5">
      <div className="relative">
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="overflow-visible"
          data-slot="pace-chart"
        >
          <line
            x1={0}
            x2={width}
            y1={height - 2}
            y2={height - 2}
            stroke="var(--border)"
            vectorEffect="non-scaling-stroke"
          />
          {reference && (
            <path
              d={path(reference)}
              fill="none"
              stroke="var(--muted-foreground)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
              data-slot="pace-reference"
            />
          )}
          {last >= 0 && (
            <>
              <path
                d={`${path(current)} L${x(last).toFixed(1)},${height - 2} L${x(0).toFixed(1)},${height - 2} Z`}
                fill="var(--primary)"
                opacity={0.08}
              />
              <path
                d={path(current)}
                fill="none"
                stroke="var(--primary)"
                strokeWidth={2}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                data-slot="pace-current"
              />
            </>
          )}
          {marker && last >= 0 && (
            <line
              x1={x(last)}
              x2={x(last)}
              y1={0}
              y2={height - 2}
              stroke="var(--foreground)"
              strokeOpacity={0.35}
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
              data-slot="pace-today"
            />
          )}
          {tips.map((tip, i) => (
            <rect key={i} x={x(i) - slot / 2} y={0} width={slot} height={height} fill="transparent">
              <title>{tip}</title>
            </rect>
          ))}
        </svg>
        {last >= 0 && (
          <span
            aria-hidden
            className="bg-primary ring-card absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2"
            style={{ left: `${(x(last) / width) * 100}%`, top: y(current[last]) }}
          />
        )}
      </div>
      <div className="text-muted-foreground flex justify-between text-[11px]">
        <span>{axis[0]}</span>
        {buckets > 1 && <span>{axis[1]}</span>}
      </div>
    </div>
  );
}
