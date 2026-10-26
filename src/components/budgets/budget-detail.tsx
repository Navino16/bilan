"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { BudgetDetail as BudgetDetailData } from "@/server/services/budgets";
import type { FlatCategory } from "@/components/transactions/category-tree";
import { CategoryAvatar, overline } from "@/components/transactions/bits";
import { transactionsHref } from "@/lib/transaction-filters";
import { BudgetBar, statusStyle } from "./budget-status";
import { BudgetActions, toEditableBudget, type BudgetFormOptions } from "./budget-actions";
import { PageHeader } from "@/components/shell/page-header";
import { formatDateRange, formatDayMonth } from "@/lib/format";
import { AssignedMonthBadge } from "@/components/transactions/assigned-month";

export function BudgetDetail({
  detail,
  categories,
  accounts,
  formOptions,
}: {
  detail: BudgetDetailData;
  categories: Record<string, FlatCategory>;
  accounts: Record<string, string>;
  formOptions: BudgetFormOptions;
}) {
  const t = useTranslations("budgets");
  const locale = useLocale();
  const router = useRouter();
  const nf = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
  const period = { from: detail.periodStart, to: detail.periodEnd };

  function lineLabel(line: BudgetDetailData["lines"][number]): string {
    if (line.label) return line.label;
    if (line.categoryId && categories[line.categoryId]) return categories[line.categoryId].name;
    if (line.accountId && accounts[line.accountId]) return accounts[line.accountId];
    if (line.categoryId || line.accountId) return t("line.hidden");
    return detail.lines.length > 1 ? t("line.otherSpending") : t("line.allSpending");
  }

  const periodLink = (id: string | null, label: string, icon: React.ReactNode) =>
    id ? (
      <Link
        href={`/${locale}/budgets/${id}`}
        aria-label={label}
        className={buttonVariants({ variant: "outline", size: "icon-sm" })}
      >
        {icon}
      </Link>
    ) : (
      <Button variant="outline" size="icon-sm" aria-label={label} disabled>
        {icon}
      </Button>
    );

  return (
    <div className="space-y-5">
      <PageHeader
        overline={
          <Link
            href={`/${locale}/budgets`}
            className="hover:text-foreground inline-flex items-center gap-1"
          >
            <ChevronLeft className="size-3.5" />
            {t("pageTitle")}
          </Link>
        }
        title={detail.name}
        badges={
          <>
            <Badge variant={detail.scope === "GROUP" ? "default" : "secondary"}>
              {detail.scope === "GROUP" ? t("scopeGroup") : t("scopePersonal")}
            </Badge>
            {detail.recurring && <Badge variant="outline">{t("recurring")}</Badge>}
            {detail.archived && <Badge variant="outline">{t("archivedBadge")}</Badge>}
          </>
        }
        subtitle={
          <>
            {formatDateRange(detail.periodStart, detail.periodEnd, locale)}
            {detail.description && (
              <p
                data-slot="budget-description"
                className="text-foreground/80 mt-1.5 wrap-anywhere whitespace-pre-line"
              >
                {detail.description}
              </p>
            )}
          </>
        }
        inlineActions={!detail.previousId && !detail.nextId}
        actions={
          <div className="flex items-center gap-2">
            {(detail.previousId || detail.nextId) && (
              <>
                {periodLink(detail.previousId, t("previousPeriod"), <ChevronLeft />)}
                {periodLink(detail.nextId, t("nextPeriod"), <ChevronRight />)}
              </>
            )}
            {detail.canManage && (
              <BudgetActions
                budget={toEditableBudget(detail)}
                archived={detail.archived}
                options={formOptions}
                afterDelete={() => router.push(`/${locale}/budgets`)}
              />
            )}
          </div>
        }
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
                  <span className="truncate font-medium" title={lineLabel(line)}>
                    {lineLabel(line)}
                  </span>
                  <Badge style={style} className="border-transparent">
                    {t(`status.${line.status}`)}
                  </Badge>
                </div>
                <BudgetBar percent={line.percent} status={line.status} />
                <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-x-3 text-sm">
                  <span>
                    {nf.format(line.spent)} / {nf.format(line.plannedAmount)}
                  </span>
                  <span>
                    {line.remaining >= 0
                      ? t("detail.remaining", { amount: nf.format(line.remaining) })
                      : t("detail.overBy", { amount: nf.format(-line.remaining) })}
                  </span>
                </div>
                {line.categoryId && categories[line.categoryId] && (
                  <Link
                    href={transactionsHref(locale, period, {
                      dir: "out",
                      categoryId: line.categoryId,
                    })}
                    className="text-primary w-fit text-sm hover:underline"
                  >
                    {t("detail.seeTransactions")}
                  </Link>
                )}
              </Card>
            </li>
          );
        })}
        {detail.outOfBudget && (
          <li data-slot="budget-out-of-budget">
            <Card className="gap-1 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{t("detail.outOfBudget")}</span>
                <span className="font-medium tabular-nums">
                  {nf.format(detail.outOfBudget.spent)}
                </span>
              </div>
              <p className="text-muted-foreground text-sm">
                {t("detail.outOfBudgetHint", { count: detail.outOfBudget.count })}
              </p>
            </Card>
          </li>
        )}
      </ul>

      <Card className="gap-0 overflow-hidden p-0" data-slot="budget-transactions">
        <div className="p-5">
          <div className={overline}>{t("detail.counted")}</div>
          <div className="font-display text-xl">
            {t("detail.transactions", { count: detail.transactionCount })}
          </div>
          {detail.transactionCount > detail.transactions.length && (
            <div className="text-muted-foreground text-xs">
              {t("detail.latestOnly", { count: detail.transactions.length })}
            </div>
          )}
        </div>
        <div className="border-t">
          {detail.transactions.length === 0 ? (
            <p className="text-muted-foreground p-5 text-sm">{t("detail.noTransactions")}</p>
          ) : (
            detail.transactions.map((tx) => {
              const meta = tx.categoryId ? categories[tx.categoryId] : undefined;
              return (
                <div
                  key={tx.id}
                  data-slot="budget-transaction-row"
                  className="flex items-center gap-3 border-b px-5 py-2.5 last:border-b-0"
                >
                  <CategoryAvatar category={meta} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm">{tx.label ?? t("detail.hiddenTx")}</span>
                      <AssignedMonthBadge date={tx.date} periodDate={tx.periodDate} />
                    </div>
                    <div className="text-muted-foreground truncate text-[11.5px]">
                      {formatDayMonth(tx.date, locale)}
                      {meta ? ` · ${meta.name}` : ""}
                      {tx.accountName ? ` · ${tx.accountName}` : ""}
                    </div>
                  </div>
                  <span
                    className="text-sm font-medium tabular-nums"
                    style={tx.amount > 0 ? { color: "var(--income)" } : undefined}
                  >
                    {nf.format(tx.amount)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}
