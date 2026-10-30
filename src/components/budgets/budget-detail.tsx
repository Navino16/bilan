"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { BudgetDetail as BudgetDetailData, BudgetDetailLine } from "@/server/services/budgets";
import type { FlatCategory } from "@/components/transactions/category-tree";
import { CategoryAvatar, overline } from "@/components/transactions/bits";
import { transactionsHref } from "@/lib/transaction-filters";
import { lineFlow } from "@/lib/budget-match";
import { BudgetBar, lineDisplay } from "./budget-status";
import { BudgetActions, toEditableBudget, type BudgetFormOptions } from "./budget-actions";
import { LandingCard } from "./landing-cards";
import { useBudgetLineLabel } from "./line-label";
import { PageHeader } from "@/components/shell/page-header";
import { formatDateRange, formatDayMonth } from "@/lib/format";
import { AssignedMonthBadge } from "@/components/transactions/assigned-month";

export type BudgetDetailShow = "out" | "unplanned";

export function BudgetDetail({
  detail,
  categories,
  accounts,
  formOptions,
  show,
}: {
  detail: BudgetDetailData;
  categories: Record<string, FlatCategory>;
  accounts: Record<string, string>;
  formOptions: BudgetFormOptions;
  show?: BudgetDetailShow;
}) {
  const t = useTranslations("budgets");
  const locale = useLocale();
  const router = useRouter();
  const nf = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
  const period = { from: detail.periodStart, to: detail.periodEnd };
  const attached = detail.accountId != null;
  const base = `/${locale}/budgets/${detail.id}`;
  const budgetLineLabel = useBudgetLineLabel();
  const lineLabel = (line: BudgetDetailLine) =>
    budgetLineLabel(line, {
      category: (id) => categories[id]?.name,
      account: (id) => accounts[id],
      lineCount: detail.lines.length,
    });

  function remainingText(line: BudgetDetailLine): string {
    const incoming = lineFlow(line) === "in";
    if (line.remaining >= 0)
      return t(incoming ? "detail.toReceive" : "detail.remaining", {
        amount: nf.format(line.remaining),
      });
    const amount = nf.format(-line.remaining);
    const { overrun } = lineDisplay(line);
    if (overrun === "saved") return t("detail.savedOnTop", { amount });
    return t(overrun === "more" ? "detail.moreThanPlanned" : "detail.overBy", { amount });
  }

  const lineCard = (line: BudgetDetailLine) => {
    const display = lineDisplay(line);
    return (
      <li key={line.id} data-slot="budget-line">
        <Card className="gap-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate font-medium" title={lineLabel(line)}>
              {lineLabel(line)}
            </span>
            <Badge style={display.badge.style} className="border-transparent">
              {t(display.badge.key)}
            </Badge>
          </div>
          <BudgetBar percent={line.percent} status={display.barStatus} />
          <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-x-3 text-sm">
            <span className="tabular-nums">
              {nf.format(line.spent)} / {nf.format(line.plannedAmount)}
            </span>
            <span>{remainingText(line)}</span>
          </div>
          {line.mirrorOf ? (
            <Link
              href={`/${locale}/budgets/${line.mirrorOf.budgetId}`}
              className="text-muted-foreground w-fit text-sm hover:underline"
            >
              {t("detail.mirrorOf", { name: line.mirrorOf.budgetName })}
            </Link>
          ) : (
            line.categoryId &&
            categories[line.categoryId] && (
              <Link
                href={transactionsHref(locale, period, {
                  dir: lineFlow(line) === "in" ? "in" : "out",
                  categoryId: line.categoryId,
                })}
                className="text-primary w-fit text-sm hover:underline"
              >
                {t("detail.seeTransactions")}
              </Link>
            )
          )}
        </Card>
      </li>
    );
  };

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

  const incomeLines = detail.lines.filter((l) => lineFlow(l) === "in");
  const spendingLines = detail.lines.filter((l) => lineFlow(l) === "out");

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
            {detail.accountId && accounts[detail.accountId] && (
              <Badge variant="outline" data-slot="budget-account">
                {accounts[detail.accountId]}
              </Badge>
            )}
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

      {detail.landing && detail.accountId && (
        <LandingCard
          accountName={accounts[detail.accountId] ?? ""}
          landing={detail.landing}
          periodEnd={detail.periodEnd}
          fromSavings={detail.unplannedIncome?.fromSavings ?? 0}
        />
      )}

      {detail.forecast && (
        <Card className="gap-1 p-4" data-slot="budget-forecast">
          <div className="text-muted-foreground text-xs">
            {t("forecast.title", { date: formatDayMonth(detail.periodEnd, locale) })}
          </div>
          <div
            className="font-display text-2xl leading-none"
            style={detail.forecast.endBalance < 0 ? { color: "var(--expense)" } : undefined}
          >
            {nf.format(detail.forecast.endBalance)}
          </div>
          <p className="text-muted-foreground text-sm">
            {t("forecast.breakdown", {
              balance: nf.format(detail.forecast.balance),
              remaining: nf.format(detail.forecast.remaining),
            })}
          </p>
        </Card>
      )}

      {attached ? (
        <>
          <section className="space-y-3" data-slot="budget-income">
            <SectionHeading
              title={t("detail.income")}
              done={nf.format(detail.incomeReceived)}
              planned={nf.format(detail.incomePlanned)}
            />
            <ul className="space-y-3">
              {incomeLines.map(lineCard)}
              {detail.unplannedIncome && (
                <li data-slot="budget-unplanned">
                  <Card className="gap-1 p-4">
                    <Link href={`${base}?show=unplanned`} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{t("detail.unplannedIncome")}</span>
                        <span className="font-medium tabular-nums">
                          {nf.format(detail.unplannedIncome.received)}
                        </span>
                      </div>
                      <p className="text-muted-foreground text-sm">
                        {t("detail.unplannedHint", { count: detail.unplannedIncome.count })}
                      </p>
                      {detail.unplannedIncome.fromSavings > 0 && (
                        <p className="text-sm font-medium" data-slot="budget-from-savings">
                          {t("detail.fromSavings", {
                            amount: nf.format(detail.unplannedIncome.fromSavings),
                          })}
                        </p>
                      )}
                    </Link>
                  </Card>
                </li>
              )}
            </ul>
          </section>
          <section className="space-y-3" data-slot="budget-spending">
            <SectionHeading
              title={t("detail.spending")}
              done={nf.format(detail.spentTotal)}
              planned={nf.format(detail.plannedTotal)}
            />
            <ul className="space-y-3">
              {spendingLines.map(lineCard)}
              {detail.outOfBudget && (
                <li data-slot="budget-out-of-budget">
                  <Card className="gap-1 p-4">
                    <Link href={`${base}?show=out`} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{t("detail.outOfBudget")}</span>
                        <span className="font-medium tabular-nums">
                          {nf.format(detail.outOfBudget.spent)}
                          {detail.outOfBudget.planned != null && (
                            <span className="text-muted-foreground font-normal">
                              {" "}
                              / {nf.format(detail.outOfBudget.planned)}
                            </span>
                          )}
                        </span>
                      </div>
                      <p className="text-muted-foreground text-sm">
                        {t("detail.outOfBudgetAccountHint", { count: detail.outOfBudget.count })}
                      </p>
                    </Link>
                    {detail.outOfBudget.unmatchedTransfers > 0 && (
                      <Link
                        href={`/${locale}/transactions/suggestions`}
                        data-slot="budget-unmatched-transfers"
                        className="text-primary w-fit text-sm hover:underline"
                      >
                        {t("detail.unmatchedTransfers", {
                          count: detail.outOfBudget.unmatchedTransfers,
                        })}
                      </Link>
                    )}
                  </Card>
                </li>
              )}
            </ul>
          </section>
        </>
      ) : (
        <ul className="space-y-3">
          {detail.lines.map(lineCard)}
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
      )}

      <Card className="gap-0 overflow-hidden p-0" data-slot="budget-transactions">
        <div className="flex items-start justify-between gap-3 p-5">
          <div>
            <div className={overline}>
              {show === "out"
                ? t("detail.showingOut")
                : show === "unplanned"
                  ? t("detail.showingUnplanned")
                  : t("detail.counted")}
            </div>
            <div className="font-display text-xl">
              {t("detail.transactions", { count: detail.transactionCount })}
            </div>
            {detail.transactionCount > detail.transactions.length && (
              <div className="text-muted-foreground text-xs">
                {t("detail.latestOnly", { count: detail.transactions.length })}
              </div>
            )}
          </div>
          {show && (
            <Link href={base} className="text-primary shrink-0 text-sm hover:underline">
              {t("detail.showAll")}
            </Link>
          )}
        </div>
        <div className="border-t">
          {detail.transactions.length === 0 ? (
            <p className="text-muted-foreground p-5 text-sm">{t("detail.noTransactions")}</p>
          ) : (
            detail.transactions.map((tx) => {
              const meta = tx.categoryId ? categories[tx.categoryId] : undefined;
              const row = (
                <>
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
                </>
              );
              const rowClass = "flex items-center gap-3 border-b px-5 py-2.5 last:border-b-0";
              // The transactions page is where a row gets recategorized or assigned (design §D).
              return tx.label ? (
                <Link
                  key={tx.id}
                  data-slot="budget-transaction-row"
                  href={transactionsHref(
                    locale,
                    { from: tx.date, to: tx.date },
                    { dir: tx.amount < 0 ? "out" : "in", search: tx.label },
                  )}
                  className={`${rowClass} hover:bg-muted/50`}
                >
                  {row}
                </Link>
              ) : (
                <div key={tx.id} data-slot="budget-transaction-row" className={rowClass}>
                  {row}
                </div>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}

function SectionHeading({
  title,
  done,
  planned,
}: {
  title: string;
  done: string;
  planned: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className={overline}>{title}</h2>
      <span className="text-muted-foreground text-sm tabular-nums">
        {done} / {planned}
      </span>
    </div>
  );
}
