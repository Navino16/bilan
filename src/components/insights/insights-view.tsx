import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { overline } from "@/components/transactions/bits";
import { PeriodNav } from "@/components/dashboard/period-nav";
import { PeriodPicker } from "@/components/dashboard/period-picker";
import { ComparisonNote } from "@/components/dashboard/comparison-note";
import { PageHeader } from "@/components/shell/page-header";
import { DivergingBar } from "./diverging-bar";
import { CardTitle, Dot, ROW_LINK } from "./bits";
import { DEFAULT_CATEGORY_COLOR } from "@/lib/category-appearance";
import { CategoryHistoryCard } from "./category-history";
import { MerchantNameDialog } from "@/components/merchants/merchant-name-dialog";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BaselineSelect } from "@/components/dashboard/baseline-select";
import { categorySliceColors } from "@/lib/chart-colors";
import {
  formatPeriodLabel,
  monthsSpan,
  toIsoDay,
  type Comparison,
  type Period,
} from "@/lib/period";
import { transactionsHref, type TransactionsLinkFilter } from "@/lib/transaction-filters";
import { formatPercent } from "@/lib/format";
import type { CategoryChange, CategoryHistory, InsightsData } from "@/lib/insights";
import type { FlatCategory } from "@/components/transactions/category-tree";

const TOP_CHANGES = 6;

export async function InsightsView({
  data,
  history,
  period,
  comparison,
  categories,
  locale,
}: {
  data: InsightsData;
  history: CategoryHistory;
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
  const signed = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
    signDisplay: "exceptZero",
  });
  const pctLabel = (current: number, prev: number) =>
    prev ? formatPercent((current - prev) / prev, locale, { signed: true }) : t("new");
  const catById = new Map(categories.map((c) => [c.id, c]));
  const catName = (id: string | null) =>
    (id ? catById.get(id)?.name : undefined) ?? t("noCategory");
  const label = formatPeriodLabel(period, locale);
  const averaged = comparison.months.length > 0;
  const reference = averaged ? monthsSpan(comparison.months) : comparison.previous;
  const changesSub = averaged
    ? t("changesSubAvg", {
        current: label,
        months: formatPeriodLabel(reference, locale),
      })
    : t("changesSub", {
        current: label,
        previous: formatPeriodLabel(reference, locale),
      });
  const tone = (diff: number) => (diff > 0 ? "var(--expense)" : "var(--income)");
  const txHref = (filter: TransactionsLinkFilter, p: Period = period) =>
    transactionsHref(locale, p, filter);
  // A category that dropped to zero has nothing to show now: link to where it was spent.
  const changeHref = (c: CategoryChange) =>
    txHref({ categoryId: c.categoryId, dir: "out" }, c.current ? period : reference);

  const changes = data.changes.slice(0, TOP_CHANGES);
  const changeColors = categorySliceColors(changes, catById, DEFAULT_CATEGORY_COLOR);
  const maxDiff = Math.max(0, ...changes.map((c) => Math.abs(c.diff)));
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

  const tile = (key: "biggestIncrease" | "biggestDecrease", c: CategoryChange | undefined) => {
    const card = (
      <Card
        className={`h-full gap-1.5 p-4 ${c ? "group-hover:bg-muted/50 transition-colors" : ""}`}
      >
        <div className={overline}>{t(key)}</div>
        {c ? (
          <>
            <div className="font-display text-2xl tabular-nums" style={{ color: tone(c.diff) }}>
              {signed.format(c.diff)}
            </div>
            <div className="text-muted-foreground line-clamp-2 text-[11.5px]">
              {catName(c.categoryId)} · {pctLabel(c.current, c.previous)}
            </div>
          </>
        ) : (
          <div className="text-muted-foreground font-display text-2xl">{t("noChange")}</div>
        )}
      </Card>
    );
    return c ? (
      <Link
        href={changeHref(c)}
        className="group focus-visible:ring-ring/50 rounded-xl focus-visible:ring-3 focus-visible:outline-none"
      >
        {card}
      </Link>
    ) : (
      card
    );
  };

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
        {period.month && <BaselineSelect value={comparison.baseline} />}
        <ComparisonNote comparison={comparison} locale={locale} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        {tile(
          "biggestIncrease",
          data.changes.find((c) => c.diff > 0),
        )}
        {tile(
          "biggestDecrease",
          data.changes.find((c) => c.diff < 0),
        )}
      </div>

      <Card className="gap-4 p-6" data-slot="insights-changes">
        <CardTitle over={t("changesOverline")} title={t("changesTitle")} sub={changesSub} />
        {changes.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noData")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {changes.map((c, i) => (
              <Link
                key={c.categoryId ?? "none"}
                href={changeHref(c)}
                className={`flex flex-col gap-1.5 ${ROW_LINK}`}
              >
                <div className="flex items-center gap-2 text-sm">
                  <Dot color={changeColors[i]} />
                  <span className="min-w-0 flex-1 truncate">{catName(c.categoryId)}</span>
                  <span className="font-semibold tabular-nums" style={{ color: tone(c.diff) }}>
                    {signed.format(c.diff)}
                  </span>
                  <span className="text-muted-foreground w-16 text-right text-[11.5px] tabular-nums">
                    {pctLabel(c.current, c.previous)}
                  </span>
                </div>
                <DivergingBar value={c.diff} max={maxDiff} />
                <div className="text-muted-foreground text-[11px] tabular-nums">
                  {averaged && `${t("historyAverage")} `}
                  {money.format(c.previous)} → {money.format(c.current)}
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <CategoryHistoryCard history={history} categories={categories} locale={locale} />

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
                      <span className="min-w-0 flex-1 truncate">
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
                    <span className="min-w-0 flex-1 truncate">{catName(inc.categoryId)}</span>
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
