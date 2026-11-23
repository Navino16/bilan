import { encode } from "uqr";

const QUIET_ZONE = 4;

export function TotpQr({ uri, label }: { uri: string; label: string }) {
  const { data, size } = encode(uri, { border: 0 });
  const view = size + QUIET_ZONE * 2;
  const path = data
    .flatMap((row, y) =>
      row.map((on, x) => (on ? `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z` : "")),
    )
    .join("");
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${view} ${view}`}
      width={160}
      height={160}
      shapeRendering="crispEdges"
      className="rounded-md border bg-white"
    >
      <path d={path} fill="#000" />
    </svg>
  );
}
