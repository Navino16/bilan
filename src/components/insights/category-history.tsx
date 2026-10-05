"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { SegmentedTabs } from "@/components/transactions/bits";
import { categorySliceColors } from "@/lib/chart-colors";
import { historyRows, type CategoryHistory, type HistoryMonth } from "@/lib/insights";
import { monthPeriod } from "@/lib/period";
import { transactionsHref } from "@/lib/transaction-filters";
import type { FlatCategory } from "@/components/transactions/category-tree";
import { CardTitle, DEFAULT_COLOR, Dot, ROW_LINK } from "./bits";

const TOP_CATEGORIES = 6;
const BAR_HEIGHT = 28;
const HATCH = "repeating-linear-gradient(135deg, transparent 0 3px, rgba(255,255,255,.55) 3px 5px)";

type Span = "6" | "12";

export function CategoryHistoryCard({
  history,
  categories,
  locale,
}: {
  history: CategoryHistory;
  categories: FlatCategory[];
  locale: string;
}) {
  const t = useTranslations("insights");
  const [span, setSpan] = useState<Span>("12");
  const { months, rows } = historyRows(history, Number(span), TOP_CATEGORIES);

  const catById = new Map(categories.map((c) => [c.id, c]));
  const catName = (id: string | null) =>
    (id ? catById.get(id)?.name : undefined) ?? t("noCategory");
  // Colored on the 12-month ranking so a category keeps its shade when the span changes.
  const ranked = historyRows(history, history.months.length, Infinity).rows;
  const rankedColors = categorySliceColors(ranked, catById, DEFAULT_COLOR);
  const colorOf = (id: string | null) => rankedColors[ranked.findIndex((r) => r.categoryId === id)];
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
  const monthFmt = (m: HistoryMonth, month: "short" | "long") =>
    new Intl.DateTimeFormat(locale, { month, year: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(m.year, m.month - 1, 1)),
    );
  const first = months[0];
  const last = months[months.length - 1];
  const range = {
    from: monthPeriod(first.year, first.month).from,
    to: monthPeriod(last.year, last.month).to,
  };
  const partial = (i: number) => history.inProgress && i === months.length - 1;

  return (
    <Card className="gap-4 p-6" data-slot="insights-history">
      <div className="flex items-start justify-between gap-2">
        <CardTitle over={t("historyOverline")} title={t("historyTitle")} sub={t("historySub")} />
        <SegmentedTabs
          items={(["6", "12"] as const).map((id) => ({
            id,
            label: t("historyMonths", { count: Number(id) }),
          }))}
          value={span}
          onChange={setSpan}
        />
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t("historyEmpty", { count: Number(span) })}
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {rows.map((r) => {
              const max = Math.max(...r.values);
              return (
                <div
                  key={r.categoryId ?? "none"}
                  data-slot="history-row"
                  className="flex flex-col gap-1"
                >
                  <Link
                    href={transactionsHref(locale, range, { categoryId: r.categoryId, dir: "out" })}
                    className={`flex items-center gap-2 text-sm ${ROW_LINK}`}
                  >
                    <Dot color={colorOf(r.categoryId)} />
                    <span className="min-w-0 flex-1 truncate">{catName(r.categoryId)}</span>
                    <span className="text-muted-foreground text-[11.5px]">
                      {t("historyAverage")}
                    </span>
                    <span className="font-semibold tabular-nums">
                      {r.average ? money.format(r.average) : "—"}
                    </span>
                  </Link>
                  <div className="ml-[18px] flex items-end">
                    {r.values.map((v, i) => {
                      const label = t("historyBar", {
                        month: partial(i)
                          ? t("historyInProgress", { month: monthFmt(months[i], "long") })
                          : monthFmt(months[i], "long"),
                        amount: money.format(v),
                      });
                      return (
                        <Link
                          key={i}
                          data-slot="history-bar"
                          href={transactionsHref(
                            locale,
                            monthPeriod(months[i].year, months[i].month),
                            {
                              categoryId: r.categoryId,
                              dir: "out",
                            },
                          )}
                          // Keyboard users drill down through the row's name link: 72 tab stops otherwise.
                          tabIndex={-1}
                          aria-label={label}
                          title={label}
                          className="flex flex-1 items-end px-px"
                          style={{ height: BAR_HEIGHT }}
                        >
                          <span
                            className="w-full rounded-sm"
                            style={{
                              height: v && max ? Math.max(2, (v / max) * BAR_HEIGHT) : 0,
                              backgroundColor: colorOf(r.categoryId),
                              ...(partial(i) && { backgroundImage: HATCH, opacity: 0.6 }),
                            }}
                          />
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-muted-foreground ml-[18px] flex justify-between text-[10px]">
            <span>{monthFmt(first, "short")}</span>
            <span>
              {history.inProgress
                ? t("historyInProgress", { month: monthFmt(last, "short") })
                : monthFmt(last, "short")}
            </span>
          </div>
        </>
      )}
    </Card>
  );
}
