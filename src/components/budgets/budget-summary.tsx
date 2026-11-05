"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { overline } from "@/components/transactions/bits";
import { OrdinalText } from "@/components/ordinal-text";
import type { BudgetDetail } from "@/server/services/budgets";
import { leftToSpend, round2 } from "@/lib/budgets";
import { formatDayMonth, formatMoney, formatMonthName, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

const MINUS = "\u2212\u00a0";
const PLUS = "+\u00a0";
const negativeTone = (n: number) => (n < 0 ? { color: "var(--expense)" } : undefined);

// What is left of the plan, then where the attached account lands (#408).
export function BudgetSummary({
  detail,
  accountName,
  outHref,
}: {
  detail: BudgetDetail;
  accountName: string;
  outHref: string;
}) {
  const t = useTranslations("budgets");
  const locale = useLocale();
  const money = (n: number) => formatMoney(n, locale);
  const out = detail.outOfBudget;
  const margin = out?.planned ?? null;
  const spend = leftToSpend(
    detail.lines,
    out && margin != null ? { planned: margin, spent: out.spent } : null,
  );
  const deficit = round2(detail.plannedTotal - detail.incomePlanned);
  const { landing } = detail;
  const fromSavings = detail.unplannedIncome?.fromSavings ?? 0;

  const start = detail.periodStart;
  const calendarMonth = detail.periodType === "MONTH" && start.getUTCDate() === 1;
  const calendarYear =
    detail.periodType === "YEAR" && start.getUTCDate() === 1 && start.getUTCMonth() === 0;
  const month = formatMonthName(start, locale);
  const title = calendarMonth
    ? t("summary.month", { month, elided: /^[aeiou]/i.test(month) ? "yes" : "no" })
    : calendarYear
      ? t("summary.year", { year: String(start.getUTCFullYear()) })
      : t("summary.period");

  return (
    <Card className="gap-4 p-4" data-slot="budget-summary">
      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <div className={cn(overline, "min-w-0 truncate")}>{title}</div>
          {spend.percent != null && (
            <div className="text-muted-foreground shrink-0 text-xs tabular-nums">
              {t("summary.percentSpent", { percent: formatPercent(spend.percent / 100, locale) })}
            </div>
          )}
        </div>
        <div>
          <div className="text-muted-foreground text-sm">{t("summary.leftToSpend")}</div>
          <div
            className="font-display text-3xl leading-tight tabular-nums"
            data-slot="budget-left-to-spend"
          >
            {money(spend.left)}
          </div>
        </div>
        <div className="bg-muted h-2 w-full overflow-hidden rounded-full" aria-hidden>
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(100, spend.percent ?? 100)}%`,
              background: spend.status === "OVER" ? "var(--expense)" : "var(--primary)",
            }}
          />
        </div>
        <div className="text-muted-foreground flex flex-wrap justify-between gap-x-3 text-sm tabular-nums">
          <span>{t("summary.spent", { amount: money(spend.spent) })}</span>
          <span>{t("summary.planned", { amount: money(spend.planned) })}</span>
        </div>
      </div>

      {out && out.spent > 0 && (
        <div
          className="space-y-1 rounded-lg px-3 py-2.5"
          style={{ background: "var(--expense-bg)" }}
          data-slot="budget-summary-out"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 text-sm font-medium">
              {t("summary.outOfBudget", { count: out.count })}
            </span>
            <span
              className="font-display shrink-0 text-lg leading-tight tabular-nums"
              style={{ color: "var(--expense-text)" }}
            >
              {money(out.spent)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <Link href={outHref} className="text-primary min-w-0 hover:underline">
              {t("summary.seeTransactions")}
            </Link>
            {margin != null && (
              <span className="shrink-0 tabular-nums" style={{ color: "var(--expense-text)" }}>
                {t("detail.margin", { amount: money(margin) })}
              </span>
            )}
          </div>
        </div>
      )}

      {detail.incomePlanned > 0 && deficit > 0 && (
        <p
          className="flex gap-2 rounded-lg px-3 py-2.5 text-sm"
          style={{ background: "var(--warning-bg)", color: "var(--warning-text)" }}
          data-slot="budget-summary-deficit"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {t("summary.deficit", {
              deficit: money(deficit),
              income: money(detail.incomePlanned),
              planned: money(detail.plannedTotal),
            })}
          </span>
        </p>
      )}

      {landing && (
        <div className="space-y-3 border-t pt-4" data-slot="budget-summary-account">
          <div>
            <div className={cn(overline, "wrap-anywhere")}>
              <OrdinalText
                text={t("summary.accountOn", {
                  account: accountName,
                  date: formatDayMonth(detail.periodEnd, locale),
                })}
              />
            </div>
            <div
              className="font-display text-3xl leading-tight tabular-nums"
              style={negativeTone(landing.endBalance)}
            >
              {money(landing.endBalance)}
            </div>
          </div>
          <dl className="space-y-1.5 text-sm">
            <SummaryRow label={t("summary.balanceToday")} value={money(landing.balance)} />
            {Math.abs(landing.spendingToCome - spend.left) < 0.005 ? (
              <SummaryRow
                label={t("summary.leftToSpend")}
                value={MINUS + money(landing.spendingToCome)}
              />
            ) : (
              <SummaryRow
                label={t("summary.toPay")}
                hint={t("summary.toPayHint")}
                value={MINUS + money(landing.spendingToCome)}
              />
            )}
            <SummaryRow label={t("summary.toReceive")} value={PLUS + money(landing.incomeToCome)} />
            <div className="border-t pt-1.5">
              <SummaryRow
                strong
                label={t(calendarMonth ? "summary.endOfMonth" : "summary.endOfPeriod")}
                value={money(landing.endBalance)}
                tone={negativeTone(landing.endBalance)}
              />
            </div>
          </dl>
          {fromSavings > 0 && (
            <p className="text-sm font-medium" data-slot="landing-from-savings">
              {t("landing.fromSavings", { amount: money(fromSavings) })}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function SummaryRow({
  label,
  hint,
  value,
  tone,
  strong = false,
}: {
  label: string;
  hint?: string;
  value: string;
  tone?: { color: string };
  strong?: boolean;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", strong && "font-medium")}>
      <dt className={cn("min-w-0", !strong && "text-muted-foreground")}>
        {label}
        {hint && <span className="block text-xs">{hint}</span>}
      </dt>
      <dd className="shrink-0 tabular-nums" style={tone}>
        {value}
      </dd>
    </div>
  );
}
