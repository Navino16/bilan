import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { overline } from "@/components/transactions/bits";
import { OrdinalText } from "@/components/ordinal-text";
import type { FlatCategory } from "@/components/transactions/category-tree";
import type { getCurrentBudget } from "@/server/services/budgets";
import { BudgetBar, lineDisplay, statusStyle } from "@/components/budgets/budget-status";
import { formatDateRange, formatDayMonth, formatMoney } from "@/lib/format";
import { lineFlow } from "@/lib/budget-match";

export type CurrentBudget = Awaited<ReturnType<typeof getCurrentBudget>>;

const LINES_SHOWN = 5;

// Dashboard card for the budget in progress (design: dashboard "Budgets snapshot").
export async function BudgetSnapshot({
  budget,
  categories,
  locale,
}: {
  budget: CurrentBudget;
  categories: Map<string, FlatCategory>;
  locale: string;
}) {
  const t = await getTranslations("budgets");

  if (!budget) {
    return (
      <Card className="gap-3 p-4.5 md:p-6" data-slot="budget-snapshot">
        <div className={overline}>{t("snapshot.overline")}</div>
        <p className="text-muted-foreground text-sm">{t("snapshot.none")}</p>
        <Link href={`/${locale}/budgets`} className="text-primary w-fit text-sm hover:underline">
          {t("create")}
        </Link>
      </Card>
    );
  }

  const { detail, others, accountNames } = budget;
  const projected = detail.forecast?.endBalance ?? detail.landing?.endBalance;
  const lines = detail.accountId ? detail.lines.filter((l) => lineFlow(l) === "out") : detail.lines;
  return (
    <Card className="gap-4 p-4.5 md:p-6" data-slot="budget-snapshot">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={overline}>
            <OrdinalText text={formatDateRange(detail.periodStart, detail.periodEnd, locale)} />
          </div>
          <div className="font-display truncate text-xl">{detail.name}</div>
        </div>
        <Link
          href={`/${locale}/budgets/${detail.id}`}
          className="text-primary inline-flex shrink-0 items-center gap-0.5 text-sm hover:underline"
        >
          {t("snapshot.detail")}
          <ChevronRight className="size-4" />
        </Link>
      </div>
      {projected !== undefined && (
        <div
          data-slot="budget-snapshot-forecast"
          className="flex items-baseline justify-between gap-2 text-sm"
        >
          <span className="text-muted-foreground">
            {t("forecast.title", { date: formatDayMonth(detail.periodEnd, locale) })}
          </span>
          <span
            className="shrink-0 font-medium tabular-nums"
            style={projected < 0 ? { color: "var(--expense)" } : undefined}
          >
            {formatMoney(projected, locale)}
          </span>
        </div>
      )}
      <div className="flex flex-col gap-3.5">
        {lines.slice(0, LINES_SHOWN).map((l) => {
          const cat = l.categoryId ? categories.get(l.categoryId) : undefined;
          const counterpart = l.counterpartAccountId
            ? accountNames[l.counterpartAccountId]
            : undefined;
          const name =
            l.label ??
            (l.kind === "TRANSFER"
              ? t(l.direction === "IN" ? "line.transferFrom" : "line.transferTo", {
                  account: counterpart ?? t("line.hidden"),
                })
              : undefined) ??
            cat?.name ??
            (l.accountId ? accountNames[l.accountId] : undefined) ??
            (l.categoryId || l.accountId
              ? t("line.hidden")
              : detail.lines.length > 1
                ? t("line.otherSpending")
                : t("line.allSpending"));
          return (
            <div key={l.id} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: cat?.color ?? "var(--muted-foreground)" }}
                  />
                  <span className="truncate">{name}</span>
                  {l.status === "OVER" && lineDisplay(l).overrun === "over" && (
                    <Badge style={statusStyle("OVER")} className="border-transparent">
                      {t("status.OVER")}
                    </Badge>
                  )}
                </div>
                <span
                  className="shrink-0 text-[12.5px] tabular-nums"
                  style={
                    l.status === "OVER" && lineDisplay(l).overrun === "over"
                      ? { color: "var(--expense)" }
                      : undefined
                  }
                >
                  {formatMoney(l.spent, locale)}{" "}
                  <span className="text-muted-foreground">
                    / {formatMoney(l.plannedAmount, locale)}
                  </span>
                </span>
              </div>
              <BudgetBar percent={l.percent} status={lineDisplay(l).barStatus} />
            </div>
          );
        })}
      </div>
      {(lines.length > LINES_SHOWN || others > 0) && (
        <Link href={`/${locale}/budgets`} className="text-muted-foreground text-xs hover:underline">
          {others > 0
            ? t("snapshot.others", { count: others })
            : t("snapshot.moreLines", { count: lines.length - LINES_SHOWN })}
        </Link>
      )}
    </Card>
  );
}
