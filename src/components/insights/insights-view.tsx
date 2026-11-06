import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { CategoryLabel } from "@/components/transactions/bits";
import { PeriodNav } from "@/components/dashboard/period-nav";
import { PeriodPicker } from "@/components/dashboard/period-picker";
import { ComparisonNote } from "@/components/dashboard/comparison-note";
import { PageHeader } from "@/components/shell/page-header";
import { CardTitle, Dot, ROW_LINK } from "./bits";
import { OverviewCard } from "./overview-card";
import { RecurringCard } from "./recurring-card";
import { CategoryTrends, type ChangeView, type TrendView } from "./category-trends";
import { DEFAULT_CATEGORY_COLOR } from "@/lib/category-appearance";
import { MerchantNameDialog } from "@/components/merchants/merchant-name-dialog";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BaselineSelect } from "@/components/dashboard/baseline-select";
import { categorySliceColors } from "@/lib/chart-colors";
import {
  formatPeriodLabel,
  INSIGHTS_BASELINE,
  monthPeriod,
  monthsSpan,
  toIsoDay,
  type Comparison,
  type Period,
} from "@/lib/period";
import { transactionsHref, type TransactionsLinkFilter } from "@/lib/transaction-filters";
import { formatPercent } from "@/lib/format";
import type { CategoryChange, InsightsData } from "@/lib/insights";
import { categoryPath, type FlatCategory } from "@/components/transactions/category-tree";

export async function InsightsView({
  data,
  period,
  comparison,
  categories,
  locale,
}: {
  data: InsightsData;
  period: Period;
  comparison: Comparison;
  categories: FlatCategory[];
  locale: string;
}) {
  const t = await getTranslations("insights");
  const tm = await getTranslations("merchants");
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
  const pctLabel = (current: number, prev: number) =>
    prev ? formatPercent((current - prev) / prev, locale, { signed: true }) : t("new");
  const catById = new Map(categories.map((c) => [c.id, c]));
  const catOf = (id: string | null) => (id ? catById.get(id) : undefined);
  const catName = (id: string | null) => {
    const c = catOf(id);
    return c ? categoryPath(c) : t("noCategory");
  };
  const catLabel = (id: string | null) => (
    <CategoryLabel category={catOf(id)} fallback={t("noCategory")} className="flex-1" />
  );
  const label = formatPeriodLabel(period, locale);
  const averaged = comparison.months.length > 0;
  const reference = averaged ? monthsSpan(comparison.months) : comparison.previous;
  const trendsSub = averaged
    ? t("categoriesSubAvg", { current: label, months: formatPeriodLabel(reference, locale) })
    : t("categoriesSub", { current: label, previous: formatPeriodLabel(reference, locale) });
  const txHref = (filter: TransactionsLinkFilter, p: Period = period) =>
    transactionsHref(locale, p, filter);

  // Under its root, a subcategory shows its path below the root only.
  const childLabel = (id: string) => {
    const c = catById.get(id);
    return c && { ...c, parents: c.parents.slice(1) };
  };
  // A category that dropped to zero has nothing to show now: link to where it was spent.
  const changeViews = (changes: CategoryChange[], under?: string): ChangeView[] => {
    const colors = categorySliceColors(changes, catById, DEFAULT_CATEGORY_COLOR);
    return changes.map((c, i) => ({
      ...c,
      color: colors[i],
      href: txHref({ categoryId: c.categoryId, dir: "out" }, c.current ? period : reference),
      category: under && c.categoryId !== under ? childLabel(c.categoryId) : catOf(c.categoryId),
    }));
  };
  const roots = changeViews(data.categories);
  const trends: TrendView[] = data.categories.map((c, i) => ({
    ...c,
    ...roots[i],
    children: changeViews(c.children, c.categoryId),
  }));
  const { overview } = data;
  const monthLabel = (m: { year: number; month: number }) =>
    new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(m.year, m.month - 1, 1)),
    );
  const monthLabels = overview.months.map((m, i) =>
    overview.inProgress && i === overview.months.length - 1
      ? t("historyInProgress", { month: monthLabel(m) })
      : monthLabel(m),
  );
  const highlight = overview.months.map((m) => {
    const p = monthPeriod(m.year, m.month);
    return p.to >= period.from && p.from <= period.to;
  });

  // One color per category (not per row): several merchants often share one.
  const merchantCats = [...new Set(data.merchants.map((m) => m.categoryId))];
  const merchantCatColors = categorySliceColors(
    merchantCats.map((categoryId) => ({ categoryId })),
    catById,
    DEFAULT_CATEGORY_COLOR,
  );
  const merchantColor = (id: string | null) => merchantCatColors[merchantCats.indexOf(id)];
  const maxMerchant = data.merchants[0]?.total ?? 0;
  const aliasNames = data.aliasGroups.map((g) => g.name);
  const aliasKeys = new Map(data.aliasGroups.map((g) => [g.name, g.keys]));
  const incomeColors = categorySliceColors(data.income, catById, DEFAULT_CATEGORY_COLOR);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <PageHeader
          overline={t("overline")}
          title={t("pageTitle")}
          subtitle={label}
          actions={
            <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
              <PeriodPicker from={toIsoDay(period.from)} to={toIsoDay(period.to)} />
              <PeriodNav period={period} />
            </div>
          }
        />
        {period.month && (
          <BaselineSelect value={comparison.baseline} fallback={INSIGHTS_BASELINE} />
        )}
        <ComparisonNote comparison={comparison} locale={locale} />
      </div>

      <OverviewCard overview={overview} locale={locale} />

      <Card className="gap-4 p-4.5 md:p-6" data-slot="insights-categories">
        <CardTitle over={t("categoriesOverline")} title={t("categoriesTitle")} sub={trendsSub} />
        <CategoryTrends
          trends={trends}
          uncategorized={
            data.uncategorized > 0
              ? {
                  amount: data.uncategorized,
                  href: txHref({ categoryId: null, dir: "out" }),
                }
              : null
          }
          months={monthLabels}
          highlight={highlight}
          inProgress={overview.inProgress}
          averaged={averaged}
          locale={locale}
        />
      </Card>

      <RecurringCard
        recurring={data.recurring}
        categoryOf={catOf}
        hrefOf={(search) => txHref({ search, dir: "out" }, data.recurring.window)}
        locale={locale}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card className="gap-4 p-6" data-slot="insights-merchants">
          <CardTitle over={t("merchantsOverline")} title={t("merchantsTitle")} />
          {data.merchants.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noMerchants")}</p>
          ) : (
            <ol className="flex flex-col gap-1.5">
              {data.merchants.map((m, i) => (
                <li
                  key={m.alias ? `a:${m.alias}` : `k:${m.keys[0]}`}
                  className="flex items-start gap-1"
                >
                  <Link
                    href={txHref({ search: m.search, dir: "out" })}
                    className={`flex min-w-0 flex-1 flex-col gap-1.5 ${ROW_LINK}`}
                  >
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground w-4 text-[11.5px] tabular-nums">
                        {i + 1}
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate"
                        title={`${m.label} · ${catName(m.categoryId)} · ${t("merchantsCount", { count: m.count })}`}
                      >
                        {m.label}
                        <span className="text-muted-foreground text-[11.5px]">
                          {" "}
                          · {catName(m.categoryId)} · {t("merchantsCount", { count: m.count })}
                        </span>
                      </span>
                      <span className="font-semibold tabular-nums">{money.format(m.total)}</span>
                    </div>
                    <div className="bg-muted ml-6 h-1.5 rounded">
                      <div
                        className="h-1.5 rounded"
                        style={{
                          width: `${maxMerchant ? (m.total / maxMerchant) * 100 : 0}%`,
                          background: merchantColor(m.categoryId),
                        }}
                      />
                    </div>
                  </Link>
                  <MerchantNameDialog
                    target={{
                      key: m.alias ? null : m.keys[0],
                      alias: m.alias,
                      keys: aliasKeys.get(m.alias ?? "") ?? m.keys,
                      label: m.label,
                    }}
                    names={aliasNames}
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground -mr-1.5"
                        aria-label={tm("rename", { name: m.label })}
                      >
                        <Pencil />
                      </Button>
                    }
                  />
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card className="gap-4 p-6" data-slot="insights-income">
          <CardTitle
            over={t("incomeOverline")}
            title={t("incomeTitle")}
            sub={
              data.income.length
                ? t("incomeTotal", { amount: money.format(data.incomeTotal) })
                : undefined
            }
          />
          {data.income.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noIncome")}</p>
          ) : (
            <>
              <div className="flex h-3 overflow-hidden rounded-full">
                {data.income.map((inc, i) => (
                  <div
                    key={inc.categoryId ?? "none"}
                    style={{
                      width: `${(inc.current / data.incomeTotal) * 100}%`,
                      background: incomeColors[i],
                    }}
                  />
                ))}
              </div>
              <div className="flex flex-col gap-0.5">
                {data.income.map((inc, i) => (
                  <Link
                    key={inc.categoryId ?? "none"}
                    href={txHref({ categoryId: inc.categoryId, dir: "in" })}
                    className={`flex items-center gap-2 text-sm ${ROW_LINK}`}
                  >
                    <Dot color={incomeColors[i]} />
                    {catLabel(inc.categoryId)}
                    <span className="tabular-nums">{money.format(inc.current)}</span>
                    <span className="text-muted-foreground w-16 text-right text-[11.5px] tabular-nums">
                      {inc.current === inc.previous ? "=" : pctLabel(inc.current, inc.previous)}
                    </span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
