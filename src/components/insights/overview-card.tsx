import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { HistoryMonth, InsightsOverview } from "@/lib/insights";
import { CardTitle, Dot, HATCH } from "./bits";

const BAR_HEIGHT = 112;

export async function OverviewCard({
  overview,
  locale,
}: {
  overview: InsightsOverview;
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
  const monthFmt = (m: HistoryMonth, month: "narrow" | "short" | "long") =>
    new Intl.DateTimeFormat(locale, {
      month,
      year: month === "long" ? "numeric" : undefined,
      timeZone: "UTC",
    }).format(new Date(Date.UTC(m.year, m.month - 1, 1)));
  const { months, flows } = overview;
  const last = months.length - 1;
  const partial = (i: number) => overview.inProgress && i === last;
  const max = Math.max(0, ...flows.flatMap((f) => [f.income, f.expense]));
  const height = (v: number) => (v && max ? Math.max(2, (v / max) * BAR_HEIGHT) : 0);
  const recorded = overview.dataStart < months.length;

  const stats = [
    {
      key: "income",
      label: t("overviewIncome"),
      color: "var(--income)",
      value: money.format(overview.average.income),
      sub: t("perMonth"),
    },
    {
      key: "expense",
      label: t("overviewSpending"),
      color: "var(--expense)",
      value: money.format(overview.average.expense),
      sub: t("perMonth"),
    },
    {
      key: "net",
      label: t("overviewNet"),
      color: null,
      value: signed.format(overview.net),
      sub: t("overviewNetSub"),
    },
  ];

  return (
    <Card className="gap-4 p-4.5 md:p-6" data-slot="insights-overview">
      <CardTitle over={t("overviewOverline")} title={t("overviewTitle")} />
      {!recorded ? (
        <p className="text-muted-foreground text-sm">{t("overviewEmpty")}</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            {stats.map((s) => (
              <div key={s.key} data-slot="overview-stat" className="min-w-0">
                <div className="text-muted-foreground flex items-center gap-1.5 text-[11.5px]">
                  {s.color && <Dot color={s.color} />}
                  <span className="truncate">{s.label}</span>
                </div>
                <div className="font-display text-[15px] tabular-nums sm:text-xl">{s.value}</div>
                <div className="text-muted-foreground text-[11px]">{s.sub}</div>
              </div>
            ))}
          </div>
          <div>
            <div className="flex items-end gap-1 sm:gap-2" style={{ height: BAR_HEIGHT }}>
              {flows.map((f, i) => {
                const month = partial(i)
                  ? t("historyInProgress", { month: monthFmt(months[i], "long") })
                  : monthFmt(months[i], "long");
                const label = t("overviewBar", {
                  month,
                  income: money.format(f.income),
                  spending: money.format(f.expense),
                });
                return (
                  <div
                    key={i}
                    role="img"
                    aria-label={label}
                    title={label}
                    data-slot="overview-month"
                    className="flex h-full flex-1 items-end justify-center gap-px sm:gap-0.5"
                  >
                    {(["income", "expense"] as const).map((side) => (
                      <span
                        key={side}
                        className="w-full max-w-4 rounded-t-sm"
                        style={{
                          height: height(f[side]),
                          backgroundColor: `var(--${side})`,
                          ...(partial(i) && { backgroundImage: HATCH, opacity: 0.7 }),
                        }}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
            <div className="border-border mt-1 flex gap-1 border-t pt-1 sm:gap-2">
              {months.map((m, i) => (
                <span
                  key={i}
                  aria-hidden
                  className={cn(
                    "text-muted-foreground flex-1 text-center text-[10px] capitalize",
                    partial(i) && "text-foreground font-medium",
                  )}
                >
                  <span className="sm:hidden">{monthFmt(m, "narrow")}</span>
                  <span className="hidden sm:inline">{monthFmt(m, "short")}</span>
                </span>
              ))}
            </div>
          </div>
          {overview.spendingAbove > 0 && (
            <p
              data-slot="overview-above"
              className="rounded-lg px-3 py-2 text-[12.5px]"
              style={{ background: "var(--warning-bg)", color: "var(--warning-text)" }}
            >
              {t("overviewAbove", { count: overview.spendingAbove, total: overview.complete })}
            </p>
          )}
        </>
      )}
    </Card>
  );
}
