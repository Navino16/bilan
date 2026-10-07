"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { rollRecurringAction } from "@/server/transport/actions/budgets";
import { nextPeriod } from "@/lib/budgets";
import type { BudgetPeriodType } from "@/lib/validation/budget";
import { BudgetForm, type BudgetLineOption } from "./budget-form";
import type { CategoryOption } from "@/components/categories/category-options";
import { BudgetBar, statusStyle } from "./budget-status";
import type { BudgetAccountOption, BudgetListItem } from "@/server/services/budgets";
import { PageHeader } from "@/components/shell/page-header";

export function BudgetsView({
  budgets,
  categories,
  accounts,
  groups,
}: {
  budgets: BudgetListItem[];
  categories: CategoryOption[];
  accounts: BudgetAccountOption[];
  groups: BudgetLineOption[];
}) {
  const t = useTranslations("budgets");
  const locale = useLocale();
  const router = useRouter();
  const [rolling, startRoll] = useTransition();
  const nf = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
  // periodStart/periodEnd are UTC-bounded semantic dates — format in UTC so
  // server and client agree (periodEnd sits at 23:59:59.999Z).
  const df = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

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
                      start: df.format(rolledPeriod.start),
                      end: df.format(rolledPeriod.end),
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
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <ul className="space-y-3">
          {budgets.map((b) => (
            <li key={b.id}>
              <Link href={`/${locale}/budgets/${b.id}`} className="block">
                <Card
                  data-slot="budget-card"
                  className="hover:border-primary/40 gap-3 p-4 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 truncate font-medium">{b.name}</p>
                      <Badge style={statusStyle(b.status)} className="shrink-0 border-transparent">
                        {t(`status.${b.status}`)}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <Badge variant={b.scope === "GROUP" ? "default" : "secondary"}>
                          {b.scope === "GROUP" ? t("scopeGroup") : t("scopePersonal")}
                        </Badge>
                        {b.recurring && <Badge variant="outline">{t("recurring")}</Badge>}
                        <span>
                          {df.format(b.periodStart)} – {df.format(b.periodEnd)}
                        </span>
                      </div>
                      {b.rollable && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={rolling}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            roll(b);
                          }}
                        >
                          <RefreshCw />
                          {t("roll")}
                        </Button>
                      )}
                    </div>
                  </div>
                  <BudgetBar percent={b.percent} status={b.status} />
                  <div className="text-muted-foreground flex items-center justify-between text-sm tabular-nums">
                    <span>
                      {nf.format(b.spentTotal)} / {nf.format(b.plannedTotal)}
                    </span>
                    <span>{b.percent} %</span>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
