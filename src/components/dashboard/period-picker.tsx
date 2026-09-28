"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SegmentedTabs } from "@/components/transactions/bits";
import { PERIOD_PRESETS, presetPeriod, toIsoDay, type PeriodPreset } from "@/lib/period";

// The preset whose range matches the current from/to (so the segmented control
// reflects the active window), or null for a custom range.
function activePreset(from: string, to: string): PeriodPreset | null {
  for (const preset of PERIOD_PRESETS) {
    const p = presetPeriod(preset);
    if (toIsoDay(p.from) === from && toIsoDay(p.to) === to) return preset;
  }
  return null;
}

// `wrap` lays the presets out on several lines (filter sheet) instead of scrolling.
export function PeriodPicker({
  from,
  to,
  wrap = false,
}: {
  from: string;
  to: string;
  wrap?: boolean;
}) {
  const t = useTranslations("dashboard");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [customOpen, setCustomOpen] = useState(false);
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);

  // Keeps the other filters (search, type, category); a new window resets the page size.
  function go(nextFrom: string, nextTo: string) {
    const next = new URLSearchParams(params.toString());
    next.delete("limit");
    next.set("from", nextFrom);
    next.set("to", nextTo);
    router.push(`${pathname}?${next.toString()}`);
  }
  function applyPreset(preset: PeriodPreset) {
    setCustomOpen(false);
    const p = presetPeriod(preset);
    go(toIsoDay(p.from), toIsoDay(p.to));
  }
  function applyCustom() {
    if (start && end && start <= end) go(start, end);
  }

  const active = activePreset(from, to);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-none sm:flex-row sm:flex-wrap sm:items-center">
      {/* Presets scroll horizontally on narrow screens instead of overflowing the bar. */}
      <div
        className={cn(
          "-mx-0.5 max-w-full px-0.5",
          !wrap && "[scrollbar-width:none] overflow-x-auto [&::-webkit-scrollbar]:hidden",
        )}
      >
        <SegmentedTabs<PeriodPreset | "custom" | "">
          className={wrap ? "flex-wrap" : "w-max"}
          items={[
            ...PERIOD_PRESETS.map((p) => ({ id: p, label: t(`preset.${p}`) })),
            { id: "custom", label: t("preset.custom") },
          ]}
          value={customOpen ? "custom" : (active ?? "")}
          onChange={(id) =>
            id === "custom" ? setCustomOpen((v) => !v) : applyPreset(id as PeriodPreset)
          }
        />
      </div>
      {customOpen && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="border-input bg-card h-8 rounded-md border px-2 text-sm shadow-sm"
          />
          <span className="text-muted-foreground">–</span>
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="border-input bg-card h-8 rounded-md border px-2 text-sm shadow-sm"
          />
          <Button size="sm" onClick={applyCustom}>
            {t("apply")}
          </Button>
        </div>
      )}
    </div>
  );
}
