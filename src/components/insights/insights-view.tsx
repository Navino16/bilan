import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { overline } from "@/components/transactions/bits";
import { PeriodNav } from "@/components/dashboard/period-nav";
import { PeriodPicker } from "@/components/dashboard/period-picker";
import { PeriodInProgress } from "@/components/dashboard/period-in-progress";
import { PageHeader } from "@/components/shell/page-header";
import { DivergingBar } from "./diverging-bar";
import { categorySliceColors } from "@/lib/chart-colors";
import { formatPeriodLabel, toIsoDay, type Period } from "@/lib/period";
import type { CategoryChange, InsightsData } from "@/lib/insights";
import type { FlatCategory } from "@/components/transactions/category-tree";

const DEFAULT_COLOR = "#2563eb";
const TOP_CHANGES = 6;

function CardTitle({ over, title, sub }: { over: string; title: string; sub?: string }) {
  return (
    <div>
      <div className={overline}>{over}</div>
      <div className="font-display text-xl">{title}</div>
      {sub && <div className="text-muted-foreground text-[12px]">{sub}</div>}
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
  );
}

export async function InsightsView({
  data,
  period,
  previous,
  inProgress,
  categories,
  locale,
}: {
  data: InsightsData;
  period: Period;
  previous: Period;
  inProgress: boolean;
  categories: FlatCategory[];
  locale: string;
}) {
  const t = await getTranslations("insights");
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
  const pctFmt = new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0,
    signDisplay: "exceptZero",
  });
  const pctLabel = (current: number, prev: number) =>
    prev ? pctFmt.format((current - prev) / prev) : t("new");
  const catById = new Map(categories.map((c) => [c.id, c]));
  const catName = (id: string | null) =>
    (id ? catById.get(id)?.name : undefined) ?? t("noCategory");
  const label = formatPeriodLabel(period, locale);
  const previousLabel = formatPeriodLabel(previous, locale);
  const tone = (diff: number) => (diff > 0 ? "var(--expense)" : "var(--income)");

  const changes = data.changes.slice(0, TOP_CHANGES);
  const changeColors = categorySliceColors(changes, catById, DEFAULT_COLOR);
  const maxDiff = Math.max(0, ...changes.map((c) => Math.abs(c.diff)));
  // One color per category (not per row): several merchants often share one.
  const merchantCats = [...new Set(data.merchants.map((m) => m.categoryId))];
  const merchantCatColors = categorySliceColors(
    merchantCats.map((categoryId) => ({ categoryId })),
    catById,
    DEFAULT_COLOR,
  );
  const merchantColor = (id: string | null) => merchantCatColors[merchantCats.indexOf(id)];
  const maxMerchant = data.merchants[0]?.total ?? 0;
  const incomeColors = categorySliceColors(data.income, catById, DEFAULT_COLOR);

  const tile = (key: "biggestIncrease" | "biggestDecrease", c: CategoryChange | undefined) => (
    <Card className="gap-1.5 p-4">
      <div className={overline}>{t(key)}</div>
      {c ? (
        <>
          <div className="font-display text-2xl tabular-nums" style={{ color: tone(c.diff) }}>
            {signed.format(c.diff)}
          </div>
          <div className="text-muted-foreground truncate text-[11.5px]">
            {catName(c.categoryId)} · {pctLabel(c.current, c.previous)}
          </div>
        </>
      ) : (
        <div className="text-muted-foreground font-display text-2xl">{t("noChange")}</div>
      )}
    </Card>
  );

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
        {inProgress && <PeriodInProgress previousLabel={previousLabel} />}
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
        <CardTitle
          over={t("changesOverline")}
          title={t("changesTitle")}
          sub={t("changesSub", { current: label, previous: previousLabel })}
        />
        {changes.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noData")}</p>
        ) : (
          <div className="flex flex-col gap-4">
            {changes.map((c, i) => (
              <div key={c.categoryId ?? "none"} className="flex flex-col gap-1.5">
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
                  {money.format(c.previous)} → {money.format(c.current)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="gap-4 p-6" data-slot="insights-merchants">
          <CardTitle over={t("merchantsOverline")} title={t("merchantsTitle")} />
          {data.merchants.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noMerchants")}</p>
          ) : (
            <ol className="flex flex-col gap-3.5">
              {data.merchants.map((m, i) => (
                <li key={m.label} className="flex flex-col gap-1.5">
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
              <div className="flex flex-col gap-2.5">
                {data.income.map((inc, i) => (
                  <div key={inc.categoryId ?? "none"} className="flex items-center gap-2 text-sm">
                    <Dot color={incomeColors[i]} />
                    <span className="min-w-0 flex-1 truncate">{catName(inc.categoryId)}</span>
                    <span className="tabular-nums">{money.format(inc.current)}</span>
                    <span className="text-muted-foreground w-16 text-right text-[11.5px] tabular-nums">
                      {inc.current === inc.previous ? "=" : pctLabel(inc.current, inc.previous)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
