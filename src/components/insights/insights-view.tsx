import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { overline } from "@/components/transactions/bits";
import { Donut, ChartLegend, TrendBars } from "@/components/dashboard/charts";
import { PeriodNav } from "@/components/dashboard/period-nav";
import { PeriodPicker } from "@/components/dashboard/period-picker";
import type { DashboardData } from "@/server/services/dashboard";
import type { Period } from "@/lib/period";
import type { FlatCategory } from "@/components/transactions/category-tree";
import { formatPeriodLabel, toIsoDay } from "@/lib/period";

const DEFAULT_COLOR = "#2563eb";
const TOP_N = 8;

export async function InsightsView({
  data,
  period,
  categories,
  locale,
}: {
  data: DashboardData;
  period: Period;
  categories: FlatCategory[];
  locale: string;
}) {
  const t = await getTranslations("insights");
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
  const catById = new Map(categories.map((c) => [c.id, c]));
  const label = formatPeriodLabel(period, locale);

  const topCats = data.byCategory.slice(0, TOP_N);
  const legendItems = topCats.map((c) => {
    const meta = c.categoryId ? catById.get(c.categoryId) : undefined;
    return {
      label: meta?.name ?? t("noCategory"),
      value: money.format(c.amount),
      color: meta?.color ?? DEFAULT_COLOR,
    };
  });

  // The trace buckets by day (short spans) or by month (quarter/year); the bar
  // tooltip labels follow suit (UTC-bounded → no hydration drift).
  const isMonthlyTrace = data.trace.granularity === "month";
  const traceLabelFmt = new Intl.DateTimeFormat(
    locale,
    isMonthlyTrace
      ? { month: "short", year: "numeric", timeZone: "UTC" }
      : { day: "numeric", month: "short", timeZone: "UTC" },
  );
  const trendPoints = data.trace.points.map((p) => ({
    date: p.date,
    amount: p.amount,
    label: traceLabelFmt.format(new Date(`${p.date}T00:00:00.000Z`)),
  }));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="space-y-1">
          <div className={overline}>{t("overline")}</div>
          <h1 className="font-display text-4xl leading-none">{t("pageTitle")}</h1>
          <p className="text-muted-foreground text-sm">{label}</p>
        </div>
        <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
          <PeriodPicker from={toIsoDay(period.from)} to={toIsoDay(period.to)} />
          <PeriodNav period={period} />
        </div>
      </header>

      {/* Category donut + legend */}
      <Card className="gap-4 p-6">
        <div>
          <div className={overline}>{t("overline")}</div>
          <div className="font-display text-xl">{t("byCategory")}</div>
        </div>
        {topCats.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noData")}</p>
        ) : (
          <div className="flex flex-col items-center gap-8 sm:flex-row sm:items-center">
            <Donut
              data={topCats.map((c) => ({
                value: c.amount,
                color: (c.categoryId && catById.get(c.categoryId)?.color) || DEFAULT_COLOR,
              }))}
              centerLabel={money.format(data.totals.expense)}
              centerSub={t("spentThisPeriod")}
            />
            <div className="w-full min-w-0 flex-1">
              <ChartLegend items={legendItems} />
            </div>
          </div>
        )}
      </Card>

      {/* Spend trend */}
      <Card className="gap-4 p-6">
        <div>
          <div className={overline}>{t("overline")}</div>
          <div className="font-display text-xl">{t("trend")}</div>
        </div>
        {trendPoints.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noData")}</p>
        ) : (
          <TrendBars points={trendPoints} format={(n) => money.format(n)} />
        )}
      </Card>
    </div>
  );
}
