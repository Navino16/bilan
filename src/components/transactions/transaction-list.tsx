"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { CategoryPicker, type FlatCategory } from "./category-picker";
import { CreateRuleDialog } from "./create-rule-dialog";
import { recategorizeTransactionAction } from "@/server/transport/actions/transactions";

export type ListItem = {
  id: string;
  date: string; // ISO
  amount: number;
  type: string;
  label: string;
  accountName: string;
  categoryId: string | null;
};

function proposePattern(label: string): string {
  const tokens = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
  return tokens.length ? tokens.reduce((a, b) => (b.length > a.length ? b : a)) : "";
}

export function TransactionList({
  items,
  categories,
}: {
  items: ListItem[];
  categories: FlatCategory[];
}) {
  const t = useTranslations("transactions");
  const locale = useLocale();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [rule, setRule] = useState<{
    pattern: string;
    categoryId: string;
    categoryName: string;
  } | null>(null);
  const catName = new Map(categories.map((c) => [c.id, c.name]));

  if (items.length === 0) return <p className="text-muted-foreground text-sm">{t("empty")}</p>;

  const nf = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
  const df = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" });

  // Group by ISO day (items already newest-first).
  const groups = new Map<string, ListItem[]>();
  for (const it of items) {
    const day = it.date.slice(0, 10);
    (groups.get(day) ?? groups.set(day, []).get(day)!).push(it);
  }

  function handleRecategorize(it: ListItem, categoryId: string) {
    const fd = new FormData();
    fd.set("id", it.id);
    fd.set("categoryId", categoryId);
    startTransition(async () => {
      const r = await recategorizeTransactionAction(null, fd);
      if (r?.ok) {
        router.refresh();
        if (categoryId) {
          const pattern = proposePattern(it.label);
          if (pattern)
            setRule({ pattern, categoryId, categoryName: catName.get(categoryId) ?? "" });
        }
      }
    });
  }

  return (
    <div className="space-y-6">
      {Array.from(groups.entries()).map(([day, rows]) => (
        <section key={day} className="space-y-2">
          <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {df.format(new Date(day))}
          </h2>
          <div className="divide-border border-border divide-y rounded-lg border">
            {rows.map((it) => (
              <div
                key={it.id}
                data-slot="transaction-row"
                className="flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{it.label}</p>
                  <p className="text-muted-foreground text-xs">
                    {it.accountName} · {t(`types.${it.type}`)}
                  </p>
                </div>
                <div className="w-44">
                  <CategoryPicker
                    name={`cat-${it.id}`}
                    categories={categories}
                    defaultValue={it.categoryId}
                    onChange={(id) => handleRecategorize(it, id)}
                  />
                </div>
                <span
                  className={`w-24 text-right text-sm tabular-nums ${it.amount < 0 ? "" : "text-emerald-600"}`}
                >
                  {nf.format(it.amount)}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}

      {rule && (
        <CreateRuleDialog
          open={!!rule}
          onOpenChange={(o) => !o && setRule(null)}
          pattern={rule.pattern}
          categoryId={rule.categoryId}
          categoryName={rule.categoryName}
        />
      )}
    </div>
  );
}
