import type { ReactNode } from "react";
import { Info } from "lucide-react";

export function PeriodInProgress({ children }: { children: ReactNode }) {
  return (
    <p
      data-slot="period-in-progress"
      className="text-muted-foreground flex items-start gap-1.5 text-[12.5px]"
    >
      <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      {children}
    </p>
  );
}
