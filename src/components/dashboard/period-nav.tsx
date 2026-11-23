"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigationTransition } from "@/components/shell/navigation-pending";
import { nextMonthEnd, shiftPeriod, toIsoDay, type Period } from "@/lib/period";

export function PeriodNav({ period }: { period: Period }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startNavigation] = useNavigationTransition();
  const t = useTranslations("shell.period");

  // Keeps the other params (e.g. the insights comparison baseline).
  function go(dir: 1 | -1) {
    const p = shiftPeriod(period, dir);
    const next = new URLSearchParams(params.toString());
    next.delete("limit");
    next.set("from", toIsoDay(p.from));
    next.set("to", toIsoDay(p.to));
    startNavigation(() => router.push(`${pathname}?${next.toString()}`));
  }

  // The arrows step by the period's own granularity (month/quarter/year/range).
  // Next month may already hold assigned transactions (#341); nothing later can.
  const nextDisabled = shiftPeriod(period, 1).from.getTime() > nextMonthEnd().getTime();

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button variant="ghost" size="icon-sm" aria-label={t("previous")} onClick={() => go(-1)}>
        <ChevronLeft />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("next")}
        onClick={() => go(1)}
        disabled={nextDisabled}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}
