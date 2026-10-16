"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Plus, RefreshCw, Target } from "lucide-react";
import { EmptyState } from "@/components/shell/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { rollRecurringAction } from "@/server/transport/actions/budgets";
import { groupBudgetSeries, nextPeriod } from "@/lib/budgets";
import { formatDate, formatDateRange, formatPercent } from "@/lib/format";
import type { BudgetPeriodType } from "@/lib/validation/budget";
import { BudgetForm, type BudgetLineOption } from "./budget-form";
import type { CategoryOption } from "@/components/categories/category-options";
import { BudgetBar, statusStyle } from "./budget-status";
import { BudgetActions, toEditableBudget } from "./budget-actions";
import type { BudgetAccountOption, BudgetListItem } from "@/server/services/budgets";
import { PageHeader } from "@/components/shell/page-header";

export function BudgetsView({
  budgets,
  archived,
  categories,
  accounts,
  groups,
}: {
  budgets: BudgetListItem[];
  archived: BudgetListItem[];
  categories: CategoryOption[];
  accounts: BudgetAccountOption[];
  groups: BudgetLineOption[];
}) {
  const t = useTranslations("budgets");
  const tOnboarding = useTranslations("onboarding");
  const locale = useLocale();
  const router = useRouter();
  const [rolling, startRoll] = useTransition();
  const nf = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });

  const [rollResult, setRollResult] = useState<
    { ok: true; id?: string; from: BudgetListItem } | { ok: false; error: string } | null
  >(null);

  function roll(b: BudgetListItem) {
    const fd = new FormData();
    fd.set("id", b.id);
    startRoll(async () => {
      const r = await rollRecurringAction(null, fd);
      setRollResult(
        r?.ok
          ? { ok: true, id: r.id, from: b }
          : { ok: false, error: r?.error === "FORBIDDEN" ? "FORBIDDEN" : "FAILED" },
      );
      if (r?.ok) router.refresh();
    });
  }

  const rolledPeriod =
    rollResult?.ok &&
    nextPeriod(
      rollResult.from.periodType as BudgetPeriodType,
      rollResult.from.periodStart,
      rollResult.from.periodEnd,
    );

  return (
    <div className="space-y-5">
      <PageHeader
        overline={t("overline")}
        title={t("pageTitle")}
        actions={
          <BudgetForm
            mode="create"
            categories={categories}
            accounts={accounts}
            groups={groups}
            trigger={
              <Button>
                <Plus />
                {t("create")}
              </Button>
            }
          />
        }
      />

      {rollResult && (
        <Alert variant={rollResult.ok ? "default" : "destructive"} data-slot="roll-result">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            {!rollResult.ok ? (
              t(`error.${rollResult.error}`)
            ) : !rollResult.id ? (
              t("rolledExisting")
            ) : (
              <>
                <span>
                  {rolledPeriod &&
                    t("rolledOk", {
                      name: rollResult.from.name,
                      start: formatDate(rolledPeriod.start, locale),
                      end: formatDate(rolledPeriod.end, locale),
                    })}
                </span>
                <Link href={`/${locale}/budgets/${rollResult.id}`} className="underline">
                  {t("rollView")}
                </Link>
              </>
            )}
          </AlertDescription>
        </Alert>
      )}

      {budgets.length === 0 ? (
        <EmptyState
          icon={Target}
          title={tOnboarding("budgets.title")}
          body={tOnboarding("budgets.body")}
          actions={
            <BudgetForm
              mode="create"
              categories={categories}
              accounts={accounts}
              groups={groups}
              trigger={
                <Button>
                  <Plus />
                  {tOnboarding("budgets.cta")}
                </Button>
              }
            />
          }
        />
      ) : (
        <ul className="space-y-3">
          {groupBudgetSeries(budgets).map(({ head: b, others }) => (
            <li key={b.id}>
              <Card
                data-slot="budget-card"
                className="hover:ring-primary/40 gap-3 p-4 transition-shadow"
              >
                <div className="flex items-start gap-1">
                  <Link
                    href={`/${locale}/budgets/${b.id}`}
                    className="block min-w-0 flex-1 space-y-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 truncate font-medium" title={b.name}>
                          {b.name}
                        </p>
                        <Badge
                          style={statusStyle(b.status)}
                          className="shrink-0 border-transparent"
                        >
                          {t(`status.${b.status}`)}
                        </Badge>
                      </div>
                      <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <Badge variant={b.scope === "GROUP" ? "default" : "secondary"}>
                          {b.scope === "GROUP" ? t("scopeGroup") : t("scopePersonal")}
                        </Badge>
                        {b.recurring && <Badge variant="outline">{t("recurring")}</Badge>}
                        <span>{formatDateRange(b.periodStart, b.periodEnd, locale)}</span>
                      </div>
                      {b.description && (
                        <p
                          data-slot="budget-description"
                          className="text-muted-foreground line-clamp-2 text-sm wrap-anywhere"
                        >
                          {b.description}
                        </p>
                      )}
                    </div>
                    <BudgetBar percent={b.percent} status={b.status} />
                    <div className="text-muted-foreground flex items-center justify-between text-sm tabular-nums">
                      <span>
                        {nf.format(b.spentTotal)} / {nf.format(b.plannedTotal)}
                      </span>
                      <span>
                        {b.percent === null ? "—" : formatPercent(b.percent / 100, locale)}
                      </span>
                    </div>
                  </Link>
                  {b.canManage && (
                    <BudgetActions
                      budget={toEditableBudget(b)}
                      options={{ categories, accounts, groups }}
                    />
                  )}
                </div>
                {b.rollable && (
                  <div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={rolling}
                      onClick={() => roll(b)}
                    >
                      <RefreshCw />
                      {t("roll")}
                    </Button>
                  </div>
                )}
                {others.length > 0 && (
                  <details className="group" data-slot="budget-history">
                    <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center gap-1 text-sm font-medium [&::-webkit-details-marker]:hidden">
                      <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
                      {t("otherPeriods", { count: others.length })}
                    </summary>
                    <div className="mt-1">
                      {others.map((o) => (
                        <Link
                          key={o.id}
                          href={`/${locale}/budgets/${o.id}`}
                          className="hover:bg-muted/50 flex items-center gap-3 border-t py-2 text-sm"
                        >
                          <span className="text-muted-foreground shrink-0">
                            {formatDateRange(o.periodStart, o.periodEnd, locale)}
                          </span>
                          <span className="hidden flex-1 sm:block">
                            <BudgetBar percent={o.percent} status={o.status} />
                          </span>
                          <span className="text-muted-foreground ml-auto shrink-0 tabular-nums">
                            {nf.format(o.spentTotal)} / {nf.format(o.plannedTotal)}
                          </span>
                          <Badge
                            style={statusStyle(o.status)}
                            className="hidden shrink-0 border-transparent sm:inline-flex"
                          >
                            {t(`status.${o.status}`)}
                          </Badge>
                        </Link>
                      ))}
                    </div>
                  </details>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <details className="group/archived" data-slot="archived-budgets">
          <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center gap-1 text-[0.7rem] font-medium tracking-[0.14em] uppercase [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-4 transition-transform group-open/archived:rotate-90" />
            {t("archivedTitle", { count: archived.length })}
          </summary>
          <p className="text-muted-foreground mt-1 text-xs">{t("archivedHint")}</p>
          <ul className="mt-3 space-y-2 opacity-80">
            {archived.map((b) => (
              <li key={b.id}>
                <Card data-slot="archived-budget" className="flex-row items-center gap-2 px-4 py-3">
                  <Link
                    href={`/${locale}/budgets/${b.id}`}
                    className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5 text-sm"
                  >
                    <span className="min-w-0 truncate font-medium" title={b.name}>
                      {b.name}
                    </span>
                    <span className="text-muted-foreground">
                      {formatDateRange(b.periodStart, b.periodEnd, locale)}
                    </span>
                    <span className="text-muted-foreground ml-auto tabular-nums">
                      {nf.format(b.spentTotal)} / {nf.format(b.plannedTotal)}
                    </span>
                  </Link>
                  {b.canManage && (
                    <BudgetActions
                      budget={toEditableBudget(b)}
                      archived
                      options={{ categories, accounts, groups }}
                    />
                  )}
                </Card>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
