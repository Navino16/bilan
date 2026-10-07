import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { overline } from "@/components/transactions/bits";
import type { FlatCategory } from "@/components/transactions/category-tree";
import type { getCurrentBudget } from "@/server/services/budgets";
import { BudgetBar, statusStyle } from "@/components/budgets/budget-status";

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
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const df = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });

  if (!budget) {
    return (
      <Card className="gap-3 p-6" data-slot="budget-snapshot">
        <div className={overline}>{t("snapshot.overline")}</div>
        <p className="text-muted-foreground text-sm">{t("snapshot.none")}</p>
        <Link href={`/${locale}/budgets`} className="text-primary w-fit text-sm hover:underline">
          {t("create")}
        </Link>
      </Card>
    );
  }

  const { detail, others, accountNames } = budget;
  return (
    <Card className="gap-4 p-6" data-slot="budget-snapshot">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={overline}>
            {df.format(detail.periodStart)} – {df.format(detail.periodEnd)}
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
      <div className="flex flex-col gap-3.5">
        {detail.lines.slice(0, LINES_SHOWN).map((l) => {
          const cat = l.categoryId ? categories.get(l.categoryId) : undefined;
          const name =
            l.label ??
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
                  {l.status === "OVER" && (
                    <Badge style={statusStyle("OVER")} className="border-transparent">
                      {t("status.OVER")}
                    </Badge>
                  )}
                </div>
                <span
                  className="shrink-0 text-[12.5px] tabular-nums"
                  style={l.status === "OVER" ? { color: "var(--expense)" } : undefined}
                >
                  {money.format(l.spent)}{" "}
                  <span className="text-muted-foreground">/ {money.format(l.plannedAmount)}</span>
                </span>
              </div>
              <BudgetBar percent={l.percent} status={l.status} />
            </div>
          );
        })}
      </div>
      {(detail.lines.length > LINES_SHOWN || others > 0) && (
        <Link href={`/${locale}/budgets`} className="text-muted-foreground text-xs hover:underline">
          {others > 0
            ? t("snapshot.others", { count: others })
            : t("snapshot.moreLines", { count: detail.lines.length - LINES_SHOWN })}
        </Link>
      )}
    </Card>
  );
}
