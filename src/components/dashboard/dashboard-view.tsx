import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { overline, CategoryAvatar } from "@/components/transactions/bits";
import { Donut, MiniBars } from "./charts";
import { PeriodNav } from "./period-nav";
import { PeriodPicker } from "./period-picker";
import type { DashboardData } from "@/server/services/dashboard";
import type { Period } from "@/lib/period";
import type { FlatCategory } from "@/components/transactions/category-tree";
import { formatPeriodLabel, toIsoDay } from "@/lib/period";

const DEFAULT_COLOR = "#2563eb";

function delta(cur: number, prev: number): { pct: number; up: boolean } | null {
  if (!prev) return null;
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  return { pct, up: pct >= 0 };
}

export async function DashboardView({
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
  const t = await getTranslations("dashboard");
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
  const catById = new Map(categories.map((c) => [c.id, c]));
  const label = formatPeriodLabel(period, locale);

  // The trace buckets by day (short spans) or by month (quarter/year); the title,
  // axis labels and the avg/peak stats follow suit.
  const isMonthlyTrace = data.trace.granularity === "month";
  const monthShort = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
  const traceAxis = (p?: { date: string }) =>
    !p
      ? ""
      : isMonthlyTrace
        ? monthShort.format(new Date(`${p.date}T00:00:00.000Z`))
        : p.date.slice(8, 10);
  const tracePoints = data.trace.points;

  // Compact money for the secondary stats ("1,2 k €"); the peak's day/month label.
  const moneyCompact = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const peakDateFmt = new Intl.DateTimeFormat(
    locale,
    isMonthlyTrace
      ? { month: "short", year: "numeric", timeZone: "UTC" }
      : { day: "numeric", month: "short", timeZone: "UTC" },
  );
  const peak = data.trace.peak;
  const peakCatName = peak?.categoryId ? catById.get(peak.categoryId)?.name : undefined;

  const kpis = [
    {
      key: "income",
      value: data.totals.income,
      d: delta(data.totals.income, data.previous.income),
      tone: "var(--income)",
    },
    {
      key: "expense",
      value: data.totals.expense,
      d: delta(data.totals.expense, data.previous.expense),
      tone: "var(--expense)",
    },
    {
      key: "net",
      value: data.totals.net,
      d: delta(data.totals.net, data.previous.net),
      tone: data.totals.net >= 0 ? "var(--income)" : "var(--expense)",
    },
  ] as const;

  const topCats = data.byCategory.slice(0, 6);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="space-y-1">
          <div className={overline}>{t("overline")}</div>
          <h1 className="font-display text-4xl leading-none">{label}</h1>
          <p className="text-muted-foreground text-sm">
            {t("txCount", { count: data.totals.count })}
          </p>
        </div>
        <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
          <PeriodPicker from={toIsoDay(period.from)} to={toIsoDay(period.to)} />
          <PeriodNav period={period} />
        </div>
      </header>

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {kpis.map((k) => (
          <Card key={k.key} className="gap-2 p-5">
            <div className={overline}>{t(`kpi.${k.key}`)}</div>
            <div
              className="font-display text-3xl leading-none tabular-nums"
              style={{ color: k.tone }}
            >
              {money.format(k.value)}
            </div>
            <div className="text-muted-foreground text-[11.5px]">
              {k.d
                ? t("vsPrev", { arrow: k.d.up ? "↗" : "↘", pct: Math.abs(k.d.pct) })
                : t("noPrev")}
            </div>
          </Card>
        ))}
      </div>

      {/* Donut + breakdown */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card className="gap-4 p-6">
          <div>
            <div className={overline}>{t("breakdown")}</div>
            <div className="font-display text-xl">{t("byCategory")}</div>
          </div>
          {data.totals.expense === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noExpenses")}</p>
          ) : (
            <div className="flex flex-col items-center gap-6 sm:flex-row">
              <Donut
                data={topCats.map((c) => ({
                  value: c.amount,
                  color: (c.categoryId && catById.get(c.categoryId)?.color) || DEFAULT_COLOR,
                }))}
                centerLabel={money.format(data.totals.expense)}
                centerSub={t("spentThisPeriod")}
              />
              <div className="flex w-full flex-1 flex-col gap-2">
                {topCats.map((c) => {
                  const meta = c.categoryId ? catById.get(c.categoryId) : undefined;
                  return (
                    <div key={c.categoryId ?? "none"} className="flex items-center gap-2.5 text-sm">
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: meta?.color ?? DEFAULT_COLOR }}
                      />
                      <span className="flex-1 truncate">{meta?.name ?? t("noCategory")}</span>
                      <span className="tabular-nums">{money.format(c.amount)}</span>
                      <span className="text-muted-foreground w-10 text-right text-[11.5px] tabular-nums">
                        {Math.round((c.amount / data.totals.expense) * 100)} %
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>

        {/* Expense trace (day-by-day or month-by-month) */}
        <Card className="gap-4 p-6">
          <div>
            <div className={overline}>{t(isMonthlyTrace ? "monthly" : "daily")}</div>
            <div className="font-display text-xl">
              {t(isMonthlyTrace ? "monthByMonth" : "dayByDay")}
            </div>
          </div>
          <MiniBars values={tracePoints.map((p) => p.amount)} />
          <div className="text-muted-foreground flex justify-between text-[11px]">
            <span>{traceAxis(tracePoints[0])}</span>
            <span>{traceAxis(tracePoints[tracePoints.length - 1])}</span>
          </div>
          {peak && (
            <div className="grid grid-cols-2 gap-3 border-t pt-3">
              <div className="space-y-0.5">
                <div className={overline}>{t(isMonthlyTrace ? "avgPerMonth" : "avgPerDay")}</div>
                <div className="font-display text-xl tabular-nums">
                  {moneyCompact.format(data.trace.avg)}
                </div>
              </div>
              <div className="space-y-0.5">
                <div className={overline}>{t(isMonthlyTrace ? "peakMonth" : "peakDay")}</div>
                <div className="font-display text-xl tabular-nums">
                  {moneyCompact.format(peak.amount)}
                </div>
                <div className="text-muted-foreground truncate text-[11.5px]">
                  {peakDateFmt.format(new Date(`${peak.date}T00:00:00.000Z`))}
                  {peakCatName ? ` · ${peakCatName}` : ""}
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Recent transactions */}
      <Card className="gap-0 overflow-hidden p-0">
        <div className="flex items-center justify-between p-5">
          <div className="font-display text-xl">{t("recent")}</div>
          <Link href={`/${locale}/transactions`} className="text-primary text-sm hover:underline">
            {t("seeAll")}
          </Link>
        </div>
        <div className="border-t">
          {data.recent.length === 0 ? (
            <p className="text-muted-foreground p-5 text-sm">{t("noRecent")}</p>
          ) : (
            data.recent.map((r) => {
              const meta = r.categoryId ? catById.get(r.categoryId) : undefined;
              return (
                <div
                  key={r.id}
                  data-slot="dashboard-recent-row"
                  className="flex items-center gap-3 border-b px-5 py-2.5 last:border-b-0"
                >
                  <CategoryAvatar color={meta?.color} icon={meta?.icon} size={28} />
                  <span className="min-w-0 flex-1 truncate text-sm">{r.label}</span>
                  <span
                    className="text-sm font-medium tabular-nums"
                    style={r.amount > 0 ? { color: "var(--income)" } : undefined}
                  >
                    {new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(
                      r.amount,
                    )}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}
