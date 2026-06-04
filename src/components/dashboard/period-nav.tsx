"use client";

import { useRouter, usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addMonths, monthPeriod, toIsoDay, type Period } from "@/lib/period";

export function PeriodNav({ period }: { period: Period }) {
  const router = useRouter();
  const pathname = usePathname();

  // Month nav only makes sense for a whole-month period; fall back to "now".
  const year = period.year ?? new Date().getUTCFullYear();
  const month = period.month ?? new Date().getUTCMonth() + 1;

  function go(delta: number) {
    const next = addMonths(year, month, delta);
    const p = monthPeriod(next.year, next.month);
    router.push(`${pathname}?from=${toIsoDay(p.from)}&to=${toIsoDay(p.to)}`);
  }

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon-sm" aria-label="prev" onClick={() => go(-1)}>
        <ChevronLeft />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="next" onClick={() => go(1)}>
        <ChevronRight />
      </Button>
    </div>
  );
}
