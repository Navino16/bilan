"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { SegmentedTabs } from "@/components/transactions/bits";
import { ScrollFade } from "@/components/ui/scroll-fade";
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
  // Arrow navigation changes the period from outside: the inputs follow it.
  const [shown, setShown] = useState({ from, to });
  if (shown.from !== from || shown.to !== to) {
    setShown({ from, to });
    setStart(from);
    setEnd(to);
  }
  const reversed = !!start && !!end && end < start;

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
    if (start && end && !reversed) go(start, end);
  }

  const active = activePreset(from, to);
  const presets = (
    <SegmentedTabs<PeriodPreset | "custom" | "">
      className={wrap ? "flex-wrap" : "w-max"}
      items={[
        ...PERIOD_PRESETS.map((p) => ({ id: p, label: t(`preset.${p}`) })),
        { id: "custom", label: t("preset.custom") },
      ]}
      value={customOpen || (!active && from && to) ? "custom" : (active ?? "")}
      onChange={(id) =>
        id === "custom" ? setCustomOpen((v) => !v) : applyPreset(id as PeriodPreset)
      }
    />
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-none sm:flex-row sm:flex-wrap sm:items-center">
      {wrap ? (
        <div className="-mx-0.5 max-w-full px-0.5">{presets}</div>
      ) : (
        <ScrollFade className="-m-1 max-w-full p-1">{presets}</ScrollFade>
      )}
      {customOpen && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={start}
            min="1970-01-01"
            max="2100-12-31"
            aria-label={t("rangeStart")}
            onChange={(e) => setStart(e.target.value)}
            className="border-input bg-card h-8 rounded-md border px-2 text-sm shadow-sm"
          />
          <span className="text-muted-foreground">–</span>
          <input
            type="date"
            value={end}
            min={start || "1970-01-01"}
            max="2100-12-31"
            aria-label={t("rangeEnd")}
            aria-invalid={reversed || undefined}
            onChange={(e) => setEnd(e.target.value)}
            className="border-input bg-card aria-invalid:border-destructive h-8 rounded-md border px-2 text-sm shadow-sm"
          />
          <Button size="sm" onClick={applyCustom} disabled={!start || !end || reversed}>
            {t("apply")}
          </Button>
          {reversed && (
            <p role="alert" className="text-destructive w-full text-xs">
              {t("rangeReversed")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
