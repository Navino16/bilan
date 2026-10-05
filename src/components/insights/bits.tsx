import { overline } from "@/components/transactions/bits";

export const DEFAULT_COLOR = "#2563eb";
export const ROW_LINK =
  "-mx-2 rounded-lg px-2 py-1 transition-colors hover:bg-muted/50 focus-visible:ring-ring/50 focus-visible:ring-3 focus-visible:outline-none";

export function CardTitle({ over, title, sub }: { over: string; title: string; sub?: string }) {
  return (
    <div>
      <div className={overline}>{over}</div>
      <div className="font-display text-xl">{title}</div>
      {sub && <div className="text-muted-foreground text-[12px]">{sub}</div>}
    </div>
  );
}

export function Dot({ color }: { color: string }) {
  return (
    <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
  );
}
