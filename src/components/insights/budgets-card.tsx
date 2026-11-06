import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateRange } from "@/lib/format";
import { BAR_FILL as FILL } from "@/components/budgets/budget-status";
import type { BudgetSeriesHistory } from "@/lib/budget-history";
import { CardTitle, HATCH } from "./bits";

function Swatch({ color, hatched = false }: { color: string; hatched?: boolean }) {
  return (
    <span
      aria-hidden
      className="size-2.5 shrink-0 rounded-[3px]"
      style={{ backgroundColor: color, ...(hatched && { backgroundImage: HATCH }) }}
    />
  );
}

export async function BudgetsCard({
  series,
  locale,
}: {
  series: BudgetSeriesHistory[];
  locale: string;
}) {
  if (series.length === 0) return null;
  const t = await getTranslations("insights");
  const tb = await getTranslations("budgets");
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    trailingZeroDisplay: "stripIfInteger",
  });
  const gapFormat = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
    signDisplay: "exceptZero",
  });
  const legend: { label: string; color: string; hatched?: boolean }[] = [
    { label: tb("status.OK"), color: FILL.OK },
    { label: t("budgetsLegendReached"), color: FILL.REACHED },
    { label: tb("status.OVER"), color: FILL.OVER },
    { label: t("budgetsLegendInProgress"), color: "var(--muted-foreground)", hatched: true },
  ];

  return (
    <Card className="gap-4 p-4.5 md:p-6" data-slot="insights-budgets">
      <CardTitle over={t("budgetsOverline")} title={t("budgetsTitle")} sub={t("budgetsSub")} />
      <ul className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-[11.5px]">
        {legend.map((l) => (
          <li key={l.label} className="flex items-center gap-1.5">
            <Swatch color={l.color} hatched={l.hatched} />
            {l.label}
          </li>
        ))}
      </ul>
      <ul className="flex flex-col gap-4">
        {series.map((s) => {
          const first = s.periods[0];
          const last = s.periods[s.periods.length - 1];
          const gap = Math.round(s.averageGap);
          return (
            <li
              key={s.id}
              data-slot="budget-series"
              className="flex flex-col gap-1.5 lg:grid lg:grid-cols-[minmax(0,14rem)_minmax(0,28rem)_1fr] lg:items-center lg:gap-6"
            >
              <div className="flex min-w-0 items-center gap-x-2 text-sm lg:flex-wrap">
                <span className="min-w-0 truncate font-medium" title={s.name}>
                  {s.name}
                </span>
                {s.group && (
                  <Badge variant="secondary" className="shrink-0">
                    {tb("scopeGroup")}
                  </Badge>
                )}
                <span className="text-muted-foreground ml-auto shrink-0 text-[11.5px] tabular-nums lg:ml-0 lg:basis-full">
                  {formatDateRange(first.periodStart, last.periodEnd, locale)}
                </span>
              </div>
              <div className="grid max-w-md grid-cols-12 gap-1 lg:max-w-none">
                {s.periods.map((p) => {
                  const label = t("budgetsCell", {
                    period: formatDateRange(p.periodStart, p.periodEnd, locale),
                    inProgress: String(p.inProgress),
                    status: tb(`status.${p.status}`),
                    spent: money.format(p.spent),
                    planned: money.format(p.planned),
                  });
                  return (
                    <Link
                      key={p.id}
                      href={`/${locale}/budgets/${p.id}`}
                      aria-label={label}
                      title={label}
                      data-slot="budget-period"
                      data-status={p.status}
                      className="focus-visible:ring-ring/50 h-6 rounded-[4px] transition-opacity hover:opacity-80 focus-visible:ring-3 focus-visible:outline-none"
                      style={{
                        backgroundColor: FILL[p.status],
                        ...(p.inProgress && { backgroundImage: HATCH }),
                      }}
                    />
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] tabular-nums lg:flex-col">
                <span
                  data-slot="budget-series-over"
                  style={{ color: s.over > 0 ? "var(--expense-text)" : "var(--income)" }}
                >
                  {t("budgetsOver", { over: s.over, finished: s.finished })}
                </span>
                <span
                  data-slot="budget-series-gap"
                  style={{
                    color:
                      gap > 0
                        ? "var(--expense-text)"
                        : gap < 0
                          ? "var(--income)"
                          : "var(--muted-foreground)",
                  }}
                >
                  {t("budgetsGap", { gap: gapFormat.format(gap) })}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
