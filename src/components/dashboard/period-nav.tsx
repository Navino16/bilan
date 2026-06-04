"use client";

import { useRouter, usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addMonths, monthPeriod, toIsoDay, type Period } from "@/lib/period";

export function PeriodNav({ period }: { period: Period }) {
  const router = useRouter();
  const pathname = usePathname();

  // Month nav only makes sense for a whole-month period; fall back to "now".
  const now = new Date();
  const year = period.year ?? now.getUTCFullYear();
  const month = period.month ?? now.getUTCMonth() + 1;

  // No point browsing into the future (no data yet) — disable "next" once we're
  // on the current month or later.
  const atCurrentMonth = year * 12 + month >= now.getUTCFullYear() * 12 + (now.getUTCMonth() + 1);

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
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="next"
        onClick={() => go(1)}
        disabled={atCurrentMonth}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}
