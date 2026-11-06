import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { overline } from "@/components/transactions/bits";
import { PaceChart } from "./charts";
import { cn } from "@/lib/utils";
import { formatDayMonth, formatMonthYear } from "@/lib/format";
import type { Comparison } from "@/lib/period";
import type { SpendingPace as Pace } from "@/lib/pace";

const isoDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

// Cumulative spending against the comparison (spec §5.16); the headline difference is the
// Spending KPI's, both reading the same same-date reference.
export async function SpendingPace({
  pace,
  spent,
  referenceSpent,
  hasReference,
  comparison,
  locale,
  className,
}: {
  pace: Pace;
  spent: number;
  referenceSpent: number;
  // As for the KPIs: no difference against a reference holding nothing at the same date.
  hasReference: boolean;
  comparison: Comparison;
  locale: string;
  className?: string;
}) {
  const t = await getTranslations("dashboard");
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
  const monthly = pace.granularity === "month";
  const bucketDate = (i: number) => {
    const d = isoDate(pace.start);
    if (monthly) d.setUTCMonth(d.getUTCMonth() + i);
    else d.setUTCDate(d.getUTCDate() + i);
    return d;
  };
  const bucketLabel = (i: number) =>
    monthly
      ? formatMonthYear(bucketDate(i), locale, { month: "short" })
      : formatDayMonth(bucketDate(i), locale);

  const months = comparison.months.length;
  const sameDate = comparison.elapsedDays !== null;
  const reference = months
    ? t(sameDate ? "pace.refAvgSameDate" : "pace.refAvg", { months })
    : t(sameDate ? "pace.refPrevSameDate" : "pace.refPrev");
  const diff = Math.round(spent - referenceSpent);
  const tips = Array.from({ length: pace.buckets }, (_, i) => {
    const date = bucketLabel(i);
    const cur = pace.current[i];
    const ref = pace.reference?.[i];
    if (cur === undefined) {
      return ref === undefined
        ? date
        : t("pace.tipRefOnly", { date, reference: money.format(ref) });
    }
    return ref === undefined
      ? t("pace.tip", { date, amount: money.format(cur) })
      : t("pace.tipRef", { date, amount: money.format(cur), reference: money.format(ref) });
  });

  return (
    <Card className={cn("gap-4 p-4.5 md:p-6", className)} data-slot="spending-pace">
      <div>
        <div className={overline}>{t(monthly ? "monthly" : "daily")}</div>
        <div className="font-display text-xl">{t("pace.title")}</div>
      </div>
      <div className="space-y-0.5">
        <div className="font-display text-2xl tabular-nums" data-slot="pace-headline">
          {t("pace.headline", {
            amount: money.format(spent),
            date: formatDayMonth(isoDate(pace.asOf), locale),
          })}
        </div>
        {hasReference && (
          <div
            className="text-[12.5px]"
            data-slot="pace-diff"
            style={{
              color: diff < 0 ? "var(--income)" : diff > 0 ? "var(--expense)" : undefined,
            }}
          >
            {diff === 0
              ? t("pace.same", { reference })
              : t(diff < 0 ? "pace.less" : "pace.more", {
                  amount: money.format(Math.abs(diff)),
                  reference,
                })}
          </div>
        )}
      </div>
      <PaceChart
        current={pace.current}
        reference={pace.reference}
        buckets={pace.buckets}
        tips={tips}
        axis={[bucketLabel(0), bucketLabel(pace.buckets - 1)]}
        marker={sameDate}
      />
      <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]">
        <span className="flex items-center gap-1.5">
          <span className="bg-primary h-0.5 w-4 rounded-full" aria-hidden />
          {t("pace.legendCurrent")}
        </span>
        {pace.reference && (
          <span className="flex items-center gap-1.5">
            <span className="w-4 border-t-[1.5px] border-dashed border-current" aria-hidden />
            {months ? t("pace.legendAvg", { months }) : t("pace.legendPrev")}
          </span>
        )}
      </div>
    </Card>
  );
}
