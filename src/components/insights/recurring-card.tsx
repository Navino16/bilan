import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { CategoryLabel, type CategoryLabelData } from "@/components/transactions/bits";
import { cn } from "@/lib/utils";
import type { InsightsData } from "@/lib/insights";
import type { RecurringFlag } from "@/lib/recurring";
import { CardTitle, ROW_LINK } from "./bits";

const FLAG_STYLE: Record<RecurringFlag, { color: string; background: string }> = {
  new: { color: "var(--info)", background: "var(--info-bg)" },
  increase: { color: "var(--expense-text)", background: "var(--expense-bg)" },
  stopped: { color: "var(--warning-text)", background: "var(--warning-bg)" },
};

export async function RecurringCard({
  recurring,
  categoryOf,
  hrefOf,
  locale,
}: {
  recurring: InsightsData["recurring"];
  categoryOf: (id: string | null) => CategoryLabelData | undefined;
  hrefOf: (search: string) => string;
  locale: string;
}) {
  const t = await getTranslations("insights");
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
  const day = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const { payments, monthly, extra } = recurring;
  const flagLabel: Record<RecurringFlag, string> = {
    new: t("recurringNew"),
    increase: t("recurringIncrease"),
    stopped: t("recurringStopped"),
  };

  return (
    <Card className="gap-4 p-4.5 md:p-6" data-slot="insights-recurring">
      <CardTitle title={t("recurringTitle")} sub={t("recurringSub")} />
      {payments.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("noRecurring")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-display text-2xl tabular-nums">{money.format(monthly)}</span>
            <span className="text-muted-foreground text-[12px]">{t("recurringPerMonth")}</span>
            {extra > 0 && (
              <span
                data-slot="recurring-extra"
                className="text-[12px]"
                style={{ color: "var(--expense-text)" }}
              >
                {t("recurringExtra", { amount: money.format(extra) })}
              </span>
            )}
          </div>
          <ul className="grid grid-cols-1 gap-x-8 gap-y-1 lg:grid-cols-2">
            {payments.map((p) => {
              const stopped = p.flags.includes("stopped");
              const increased = p.flags.includes("increase");
              return (
                <li key={p.id} data-slot="recurring-row">
                  <Link
                    href={hrefOf(p.search)}
                    className={cn("flex flex-col gap-0.5", ROW_LINK, stopped && "opacity-70")}
                  >
                    <div className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 truncate" title={p.label}>
                        {p.label}
                      </span>
                      {p.flags.map((f) => (
                        <span
                          key={f}
                          data-slot="recurring-flag"
                          className="shrink-0 rounded-full px-1.5 py-px text-[10.5px] font-medium"
                          style={FLAG_STYLE[f]}
                        >
                          {flagLabel[f]}
                        </span>
                      ))}
                      <span className="ml-auto shrink-0 pl-1 font-semibold tabular-nums">
                        {money.format(p.usual)}
                      </span>
                    </div>
                    <div className="text-muted-foreground flex items-center gap-2 text-[11.5px]">
                      <CategoryLabel
                        category={categoryOf(p.categoryId)}
                        fallback={t("noCategory")}
                        className="flex-1"
                      />
                      <span className="shrink-0 tabular-nums">
                        {increased
                          ? t.rich("recurringLastAmount", {
                              date: day.format(p.lastDate),
                              amount: money.format(p.last),
                              up: (chunks) => (
                                <span style={{ color: "var(--expense-text)" }}>{chunks}</span>
                              ),
                            })
                          : t("recurringLast", { date: day.format(p.lastDate) })}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}
