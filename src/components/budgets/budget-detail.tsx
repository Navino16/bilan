"use client";

import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { BudgetDetail as BudgetDetailData } from "@/server/services/budgets";
import { BudgetBar, statusStyle } from "./budget-status";
import { PageHeader } from "@/components/shell/page-header";

export function BudgetDetail({
  detail,
  categories,
  accounts,
}: {
  detail: BudgetDetailData;
  categories: Record<string, string>;
  accounts: Record<string, string>;
}) {
  const t = useTranslations("budgets");
  const locale = useLocale();
  const nf = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
  // periodStart/periodEnd are UTC-bounded semantic dates — format in UTC so
  // server and client agree (periodEnd sits at 23:59:59.999Z).
  const df = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  function lineLabel(line: BudgetDetailData["lines"][number]): string {
    if (line.label) return line.label;
    if (line.categoryId && categories[line.categoryId]) return categories[line.categoryId];
    if (line.accountId && accounts[line.accountId]) return accounts[line.accountId];
    if (line.categoryId || line.accountId) return t("line.hidden");
    return detail.lines.length > 1 ? t("line.otherSpending") : t("line.allSpending");
  }

  return (
    <div className="space-y-5">
      <PageHeader
        overline={t("overline")}
        title={detail.name}
        badges={
          <>
            <Badge variant={detail.scope === "GROUP" ? "default" : "secondary"}>
              {detail.scope === "GROUP" ? t("scopeGroup") : t("scopePersonal")}
            </Badge>
            {detail.recurring && <Badge variant="outline">{t("recurring")}</Badge>}
          </>
        }
        subtitle={`${df.format(detail.periodStart)} – ${df.format(detail.periodEnd)}`}
      />

      <Card className="flex-row items-center justify-between p-4">
        <div>
          <div className="text-muted-foreground text-xs">{t("detail.spent")}</div>
          <div className="font-display text-2xl leading-none">{nf.format(detail.spentTotal)}</div>
        </div>
        <div className="text-right">
          <div className="text-muted-foreground text-xs">{t("plannedTotal")}</div>
          <div className="font-display text-2xl leading-none">{nf.format(detail.plannedTotal)}</div>
        </div>
      </Card>

      <ul className="space-y-3">
        {detail.lines.map((line) => {
          const style = statusStyle(line.status);
          return (
            <li key={line.id}>
              <Card className="gap-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{lineLabel(line)}</span>
                  <Badge style={style} className="border-transparent">
                    {t(`status.${line.status}`)}
                  </Badge>
                </div>
                <BudgetBar percent={line.percent} status={line.status} />
                <div className="text-muted-foreground flex items-center justify-between text-sm">
                  <span>
                    {nf.format(line.spent)} / {nf.format(line.plannedAmount)}
                  </span>
                  <span>
                    {line.remaining >= 0
                      ? t("detail.remaining", { amount: nf.format(line.remaining) })
                      : t("detail.overBy", { amount: nf.format(-line.remaining) })}
                  </span>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
