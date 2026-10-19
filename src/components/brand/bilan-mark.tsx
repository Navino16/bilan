import { MARK_GLYPH, MARK_STROKE, MARK_TILE, MARK_VIEWBOX } from "@/lib/brand";
import { cn } from "@/lib/utils";

export function BilanMark({ className }: { className?: string }) {
  const tile = MARK_VIEWBOX - 2 * MARK_TILE.inset;
  return (
    <svg
      viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`}
      aria-hidden="true"
      focusable="false"
      className={cn("size-7 shrink-0", className)}
    >
      <rect
        x={MARK_TILE.inset}
        y={MARK_TILE.inset}
        width={tile}
        height={tile}
        rx={MARK_TILE.radius}
        className="fill-primary"
      />
      <path
        d={MARK_GLYPH}
        fill="none"
        strokeWidth={MARK_STROKE}
        strokeLinejoin="round"
        strokeLinecap="round"
        className="stroke-primary-foreground"
      />
    </svg>
  );
}
