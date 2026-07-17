"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { overline } from "@/components/transactions/bits";
import { rollRecurringAction } from "@/server/transport/actions/budgets";
import { BudgetForm, type BudgetLineOption } from "./budget-form";
import type { BudgetListItem } from "@/server/services/budgets";

export function BudgetsView({
  budgets,
  categories,
  accounts,
  groups,
}: {
  budgets: BudgetListItem[];
  categories: BudgetLineOption[];
  accounts: BudgetLineOption[];
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

  function roll(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    startRoll(async () => {
      const r = await rollRecurringAction(null, fd);
      if (r?.ok) router.refresh();
    });
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <header className="flex items-end justify-between gap-3">
        <div className="space-y-1">
          <div className={overline}>{t("overline")}</div>
          <h1 className="font-display text-3xl leading-none">{t("pageTitle")}</h1>
        </div>
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
      </header>

      {budgets.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <ul className="space-y-3">
          {budgets.map((b) => (
            <li key={b.id}>
              <Link href={`/${locale}/budgets/${b.id}`} className="block">
                <Card className="hover:border-primary/40 flex-row items-center justify-between gap-3 p-4 transition-colors">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{b.name}</span>
                      <Badge variant={b.scope === "GROUP" ? "default" : "secondary"}>
                        {b.scope === "GROUP" ? t("scopeGroup") : t("scopePersonal")}
                      </Badge>
                      {b.recurring && <Badge variant="outline">{t("recurring")}</Badge>}
                    </div>
                    <p className="text-muted-foreground text-sm">
                      {df.format(b.periodStart)} – {df.format(b.periodEnd)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {b.recurring && b.ended && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={rolling}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          roll(b.id);
                        }}
                      >
                        <RefreshCw />
                        {t("roll")}
                      </Button>
                    )}
                    <div className="text-right">
                      <div className="font-display text-lg leading-none">
                        {nf.format(b.plannedTotal)}
                      </div>
                      <div className="text-muted-foreground text-xs">{t("plannedTotal")}</div>
                    </div>
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
