import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { overline } from "@/components/transactions/bits";
import { BudgetBar } from "@/components/budgets/budget-status";
import { formatMoney, formatPercent } from "@/lib/format";
import type { CurrentBudget } from "@/server/services/budgets";

// One compact row per budget in progress, with the figures of its summary card (#408).
export async function CurrentBudgets({
  budgets,
  locale,
}: {
  budgets: CurrentBudget[];
  locale: string;
}) {
  if (budgets.length === 0) return null;
  const t = await getTranslations("dashboard.currentBudgets");
  return (
    <Card className="gap-3 p-4.5 md:p-6" data-slot="dashboard-budgets">
      <div>
        <div className={overline}>{t("overline")}</div>
        <div className="font-display text-xl">{t("title", { count: budgets.length })}</div>
      </div>
      <div className="flex flex-col gap-1">
        {budgets.map((b) => (
          <Link
            key={b.id}
            href={`/${locale}/budgets/${b.id}`}
            data-slot="dashboard-budget"
            className="hover:bg-muted/60 -mx-2 space-y-1.5 rounded-lg px-2 py-2"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-sm font-medium">{b.name}</span>
              <span
                className="shrink-0 text-sm tabular-nums"
                data-slot="dashboard-budget-left"
                style={b.status === "OVER" ? { color: "var(--expense-text)" } : undefined}
              >
                {t("left", { amount: formatMoney(b.leftToSpend, locale) })}
              </span>
            </div>
            <BudgetBar percent={b.percent} status={b.status} />
            <div className="text-muted-foreground flex flex-wrap items-baseline justify-between gap-x-3 text-[11.5px] tabular-nums">
              <span>
                {t("ofPlanned", {
                  percent: b.percent === null ? "—" : formatPercent(b.percent / 100, locale),
                  planned: formatMoney(b.plannedTotal, locale),
                })}
              </span>
              {b.outOfBudget && b.outOfBudget.spent > 0 && (
                <span data-slot="dashboard-budget-out" style={{ color: "var(--expense-text)" }}>
                  {t("outOfBudget", { amount: formatMoney(b.outOfBudget.spent, locale) })}
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </Card>
  );
}
