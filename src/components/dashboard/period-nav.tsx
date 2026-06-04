"use client";

import { useRouter, usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shiftPeriod, toIsoDay, type Period } from "@/lib/period";

export function PeriodNav({ period }: { period: Period }) {
  const router = useRouter();
  const pathname = usePathname();

  function go(dir: 1 | -1) {
    const p = shiftPeriod(period, dir);
    router.push(`${pathname}?from=${toIsoDay(p.from)}&to=${toIsoDay(p.to)}`);
  }

  // The arrows step by the period's own granularity (month/quarter/year/range).
  // No point browsing the future (no data yet): disable "next" once the next
  // window would start after now.
  const nextDisabled = shiftPeriod(period, 1).from.getTime() > new Date().getTime();

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon-sm" aria-label="prev" onClick={() => go(-1)}>
        <ChevronLeft />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="next"
        onClick={() => go(1)}
        disabled={nextDisabled}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}
