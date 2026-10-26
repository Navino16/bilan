import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { AssignedMonthBadge } from "@/components/transactions/assigned-month";
import { cn } from "@/lib/utils";
import { overline, CategoryAvatar } from "@/components/transactions/bits";
import { Donut, MiniBars } from "./charts";
import { PeriodNav } from "./period-nav";
import { PeriodPicker } from "./period-picker";
import type { DashboardData } from "@/server/services/dashboard";
import type { Comparison, Period } from "@/lib/period";
import type { FlatCategory } from "@/components/transactions/category-tree";
import { formatPeriodLabel, toIsoDay } from "@/lib/period";
import { formatDayMonth, formatMoney, formatMonthYear, formatPercent } from "@/lib/format";
import { PageHeader } from "@/components/shell/page-header";
import { categorySliceColors } from "@/lib/chart-colors";
import { DEFAULT_CATEGORY_COLOR } from "@/lib/category-appearance";
import { BaselineSelect } from "./baseline-select";
import { ComparisonNote } from "./comparison-note";
import { BudgetSnapshot, type CurrentBudget } from "./budget-snapshot";
import { AccountsOverview } from "./accounts-overview";
import type { VisibleAccount } from "@/server/services/accounts";

const OTHERS_COLOR = "var(--ink-4)";
const DONUT_SLICES = 6;

function delta(cur: number, prev: number): { pct: number; arrow: string } | null {
  if (!prev) return null;
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100) || 0;
  return { pct, arrow: pct > 0 ? "↗" : pct < 0 ? "↘" : "=" };
}

export async function DashboardView({
  data,
  period,
  comparison,
  categories,
  budget,
  accounts,
  locale,
}: {
  data: DashboardData;
  period: Period;
  comparison: Comparison;
  categories: FlatCategory[];
  budget: CurrentBudget;
  accounts: VisibleAccount[];
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

  const peakDate = (day: string) =>
    isMonthlyTrace
      ? formatMonthYear(`${day}T00:00:00.000Z`, locale, { month: "short" })
      : formatDayMonth(`${day}T00:00:00.000Z`, locale);
  const peak = data.trace.peak;
  const peakCatName =
    (peak?.categoryId ? catById.get(peak.categoryId)?.name : undefined) ?? t("noCategory");

  const months = comparison.months.length;
  const noReference = comparison.elapsedDays
    ? t("noSameDate")
    : months
      ? t("noAvg", { months })
      : t("noPrev");
  const pctNote = (d: ReturnType<typeof delta>) => {
    if (!d) return noReference;
    const args = { arrow: d.arrow, pct: formatPercent(Math.abs(d.pct) / 100, locale) };
    return months ? t("vsAvg", { ...args, months }) : t("vsPrev", args);
  };
  // The net can change sign between periods, which makes a % meaningless (issue #112 §7):
  // it shows the difference in euros instead.
  const netDiff = data.totals.net - data.previous.net;
  const hasPrevious = data.previous.income !== 0 || data.previous.expense !== 0;
  const signedMoney = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
    signDisplay: "exceptZero",
  });

  const kpis = [
    {
      key: "income",
      amount: money.format(data.totals.income),
      note: pctNote(delta(data.totals.income, data.previous.income)),
      tone: "var(--income)",
    },
    {
      key: "expense",
      amount: money.format(data.totals.expense),
      note: pctNote(delta(data.totals.expense, data.previous.expense)),
      tone: "var(--expense)",
    },
    {
      key: "net",
      amount: signedMoney.format(data.totals.net),
      note: hasPrevious
        ? t(months ? "vsAvgAmount" : "vsPrevAmount", {
            arrow: netDiff > 0 ? "↗" : netDiff < 0 ? "↘" : "=",
            amount: signedMoney.format(netDiff),
            months,
          })
        : noReference,
      tone:
        data.totals.net > 0
          ? "var(--income)"
          : data.totals.net < 0
            ? "var(--expense)"
            : "var(--foreground)",
    },
  ] as const;

  // Beyond 6 categories the 6th slice groups the rest, so the arcs add up to the
  // total like the legend's percentages do.
  const overflow = data.byCategory.length > DONUT_SLICES;
  const named = data.byCategory.slice(0, overflow ? DONUT_SLICES - 1 : DONUT_SLICES);
  const namedColors = categorySliceColors(named, catById, DEFAULT_CATEGORY_COLOR);
  const slices = [
    ...named.map((c, i) => ({
      key: c.categoryId ?? "none",
      name: (c.categoryId ? catById.get(c.categoryId)?.name : undefined) ?? t("noCategory"),
      amount: c.amount,
      color: namedColors[i],
    })),
    ...(overflow
      ? [
          {
            key: "others",
            name: t("otherCategories", { count: data.byCategory.length - named.length }),
            amount: data.byCategory.slice(named.length).reduce((s, c) => s + c.amount, 0),
            color: OTHERS_COLOR,
          },
        ]
      : []),
  ];
  const range = `from=${toIsoDay(period.from)}&to=${toIsoDay(period.to)}`;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <PageHeader
          overline={t("overline")}
          title={label}
          subtitle={t("txCount", { count: data.totals.count })}
          actions={
            <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
              <PeriodPicker from={toIsoDay(period.from)} to={toIsoDay(period.to)} />
              <PeriodNav period={period} />
            </div>
          }
        />
        {period.month && <BaselineSelect value={comparison.baseline} />}
        <ComparisonNote comparison={comparison} locale={locale} />
      </div>

      <AccountsOverview accounts={accounts} locale={locale} />

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 md:gap-3">
        {kpis.map((k) => (
          <Card
            key={k.key}
            data-slot="kpi-card"
            className={cn(
              "gap-1 p-3.5 md:gap-2 md:p-5",
              k.key === "net" && "col-span-2 md:col-span-1",
            )}
          >
            <div className={overline}>{t(`kpi.${k.key}`)}</div>
            <div
              className="font-display text-[1.375rem] leading-none tabular-nums md:text-3xl"
              style={{ color: k.tone }}
              data-slot="kpi-amount"
            >
              {k.amount}
            </div>
            <div className="text-muted-foreground text-[11.5px]" data-slot="kpi-note">
              {k.note}
            </div>
          </Card>
        ))}
      </div>

      {/* Donut + breakdown */}
      <div className="grid grid-cols-1 gap-4 md:gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Card className="gap-4 p-4.5 md:p-6">
          <div>
            <div className={overline}>{t("breakdown")}</div>
            <div className="font-display text-xl">{t("byCategory")}</div>
          </div>
          {data.totals.expense === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noExpenses")}</p>
          ) : (
            <div className="flex flex-col items-center gap-6 sm:flex-row">
              <Donut
                data={slices.map((s) => ({ value: s.amount, color: s.color }))}
                centerLabel={money.format(data.totals.expense)}
                centerSub={t("spentThisPeriod")}
              />
              <div className="flex w-full min-w-0 flex-1 flex-col gap-2">
                {slices.map((s) => (
                  <div
                    key={s.key}
                    data-slot="donut-legend-row"
                    className="flex items-center gap-2.5 text-sm"
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: s.color }}
                    />
                    <span className="flex-1 truncate">{s.name}</span>
                    <span className="tabular-nums">{money.format(s.amount)}</span>
                    <span className="text-muted-foreground w-10 text-right text-[11.5px] tabular-nums">
                      {formatPercent(s.amount / data.totals.expense, locale)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* Expense trace (day-by-day or month-by-month) */}
        <Card className="gap-4 p-4.5 md:p-6">
          <div>
            <div className={overline}>{t(isMonthlyTrace ? "monthly" : "daily")}</div>
            <div className="font-display text-xl">
              {t(isMonthlyTrace ? "monthByMonth" : "dayByDay")}
            </div>
          </div>
          {!peak ? (
            <p className="text-muted-foreground text-sm">{t("noExpenses")}</p>
          ) : (
            <MiniBars
              values={tracePoints.map((p) => p.amount)}
              axis={[traceAxis(tracePoints[0]), traceAxis(tracePoints[tracePoints.length - 1])]}
            />
          )}
          {peak && (
            <div className="grid grid-cols-2 gap-3 border-t pt-3">
              <div className="space-y-0.5">
                <div className={overline}>{t(isMonthlyTrace ? "avgPerMonth" : "avgPerDay")}</div>
                <div className="font-display text-xl tabular-nums">
                  {money.format(data.trace.avg)}
                </div>
              </div>
              <div className="space-y-0.5">
                <div className={overline}>{t(isMonthlyTrace ? "peakMonth" : "peakDay")}</div>
                <div className="font-display text-xl tabular-nums">{money.format(peak.amount)}</div>
                <div className="text-muted-foreground truncate text-[11.5px]">
                  {peakDate(peak.date)}
                  {` · ${peakCatName}`}
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 md:gap-5 xl:grid-cols-[1fr_1.2fr]">
        <BudgetSnapshot budget={budget} categories={catById} locale={locale} />

        {/* Recent transactions */}
        <Card className="gap-0 overflow-hidden p-0">
          <div className="flex items-center justify-between p-5">
            <div className="font-display text-xl">{t("recent")}</div>
            <Link
              href={`/${locale}/transactions?${range}`}
              className="text-primary text-sm hover:underline"
            >
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
                    <CategoryAvatar category={meta} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm">{r.label}</span>
                        <AssignedMonthBadge date={r.date} periodDate={r.periodDate} />
                      </div>
                      <div className="text-muted-foreground truncate text-[11.5px]">
                        {formatDayMonth(r.date, locale)} · {meta?.name ?? t("noCategory")}
                      </div>
                    </div>
                    <span className="text-muted-foreground hidden max-w-40 truncate text-[11.5px] sm:block">
                      {r.accountName}
                    </span>
                    <span
                      className="text-sm font-medium tabular-nums"
                      style={r.amount > 0 ? { color: "var(--income)" } : undefined}
                    >
                      {formatMoney(r.amount, locale)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
