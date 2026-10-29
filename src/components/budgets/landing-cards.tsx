"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { overline } from "@/components/transactions/bits";
import { formatDayMonth, formatMoney } from "@/lib/format";
import type { BudgetLanding } from "@/lib/budgets";

const negativeTone = (n: number) => (n < 0 ? { color: "var(--expense)" } : undefined);

export function LandingCard({
  accountName,
  landing,
  periodEnd,
  fromSavings,
  href,
}: {
  accountName: string;
  landing: BudgetLanding;
  periodEnd: Date;
  fromSavings: number;
  href?: string;
}) {
  const t = useTranslations("budgets.landing");
  const locale = useLocale();
  const money = (n: number) => formatMoney(n, locale);
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <div className={`${overline} min-w-0 truncate`}>{accountName}</div>
        <div className="text-muted-foreground shrink-0 text-xs">
          {t("on", { date: formatDayMonth(periodEnd, locale) })}
        </div>
      </div>
      <div
        className="font-display text-2xl leading-none tabular-nums"
        style={negativeTone(landing.endBalance)}
      >
        {money(landing.endBalance)}
      </div>
      <p className="text-muted-foreground text-sm tabular-nums">
        {t("breakdown", {
          balance: money(landing.balance),
          income: money(landing.incomeToCome),
          spending: money(landing.spendingToCome),
        })}
      </p>
      {fromSavings > 0 && (
        <p className="text-sm font-medium" data-slot="landing-from-savings">
          {t("fromSavings", { amount: money(fromSavings) })}
        </p>
      )}
    </>
  );
  return (
    <Card data-slot="landing-card" className="hover:ring-primary/40 gap-1.5 p-4 transition-shadow">
      {href ? (
        <Link href={href} className="flex flex-col gap-1.5">
          {body}
        </Link>
      ) : (
        body
      )}
    </Card>
  );
}

// One card per account whose attached budget is in progress (design §E).
export function LandingCards({
  budgets,
  accountNames,
}: {
  budgets: {
    id: string;
    accountId: string | null;
    periodEnd: Date;
    landing: BudgetLanding | null;
    unplannedIncome: { fromSavings: number } | null;
  }[];
  accountNames: Map<string, string>;
}) {
  const t = useTranslations("budgets.landing");
  const locale = useLocale();
  const current = budgets.filter((b) => b.landing && b.accountId);
  if (current.length === 0) return null;
  return (
    <section className="space-y-2" data-slot="landing-cards">
      <h2 className={overline}>{t("title")}</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {current
          .map((b) => ({ b, name: accountNames.get(b.accountId!) ?? "" }))
          .sort((x, y) => x.name.localeCompare(y.name, locale))
          .map(({ b, name }) => (
            <LandingCard
              key={b.id}
              accountName={name}
              landing={b.landing!}
              periodEnd={b.periodEnd}
              fromSavings={b.unplannedIncome?.fromSavings ?? 0}
              href={`/${locale}/budgets/${b.id}`}
            />
          ))}
      </div>
    </section>
  );
}
