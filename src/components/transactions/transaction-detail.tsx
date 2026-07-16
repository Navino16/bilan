"use client";

import { useEffect, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  assignTransactionAction,
  unassignTransactionAction,
  listAssignmentsForTxAction,
} from "@/server/transport/actions/budgets";
import { type FlatCategory } from "./category-picker";
import { CategoryCombobox } from "./category-combobox";
import { Pill, overline } from "./bits";

export type DetailItem = {
  id: string;
  date: string;
  amount: number;
  type: string;
  label: string;
  rawLabel: string;
  note: string | null;
  accountId: string;
  categoryId: string | null;
};

export type AccountMeta = { name: string; color: string | null; bankName: string | null };
export type AssignableBudget = { id: string; name: string; scope: "USER" | "GROUP" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className={overline}>{label}</div>
      {children}
    </div>
  );
}

export function TransactionDetail({
  item,
  accounts,
  categories,
  budgets = [],
  side,
  onClose,
  onRecategorize,
}: {
  item: DetailItem | null;
  accounts: Record<string, AccountMeta>;
  categories: FlatCategory[];
  budgets?: AssignableBudget[];
  side: "right" | "bottom";
  onClose: () => void;
  onRecategorize: (categoryId: string) => void;
}) {
  const t = useTranslations("transactions");
  const tb = useTranslations("budgets.assign");
  const locale = useLocale();

  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [chosen, setChosen] = useState("");
  const [, startAssign] = useTransition();

  // Lazily load which budgets this transaction is assigned to when the panel opens.
  // Only the async result sets state (a synchronous reset here would trip
  // react-hooks/set-state-in-effect); the section isn't rendered without an item.
  useEffect(() => {
    if (!item || budgets.length === 0) return;
    let active = true;
    listAssignmentsForTxAction(item.id).then((rows) => {
      if (active) setAssignments(Object.fromEntries(rows.map((r) => [r.budgetId, r.mode])));
    });
    return () => {
      active = false;
    };
  }, [item, budgets.length]);

  function refreshAssignments(txId: string) {
    listAssignmentsForTxAction(txId).then((rows) =>
      setAssignments(Object.fromEntries(rows.map((r) => [r.budgetId, r.mode]))),
    );
  }

  function assign(mode: "INCLUDE" | "EXCLUDE") {
    if (!item || !chosen) return;
    const fd = new FormData();
    fd.set("budgetId", chosen);
    fd.set("transactionId", item.id);
    fd.set("mode", mode);
    startAssign(async () => {
      const r = await assignTransactionAction(null, fd);
      if (r?.ok) refreshAssignments(item.id);
    });
  }

  function unassign(budgetId: string) {
    if (!item) return;
    const fd = new FormData();
    fd.set("budgetId", budgetId);
    fd.set("transactionId", item.id);
    startAssign(async () => {
      const r = await unassignTransactionAction(null, fd);
      if (r?.ok) refreshAssignments(item.id);
    });
  }

  const nf = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
  const df = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const acc = item ? accounts[item.accountId] : undefined;

  return (
    <Sheet open={!!item} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side={side}
        className="w-full gap-0 p-0 data-[side=bottom]:max-h-[85dvh] data-[side=bottom]:rounded-t-2xl sm:max-w-[380px]"
      >
        {item && (
          <div className="flex h-full flex-col overflow-y-auto">
            <div className="border-border bg-card-2 space-y-1 border-b px-6 pt-6 pb-5">
              <div className={overline}>{t("detailOverline")}</div>
              <div
                className="font-display text-4xl leading-none tabular-nums"
                style={item.amount > 0 ? { color: "var(--income)" } : undefined}
              >
                {nf.format(item.amount)}
              </div>
              <div className="text-sm">{item.label}</div>
              <div className="text-muted-foreground text-xs capitalize">
                {df.format(new Date(item.date))}
              </div>
            </div>

            <div className="flex flex-col gap-5 px-6 py-6">
              <Field label={t("category")}>
                <CategoryCombobox
                  key={item.id}
                  name={`detail-cat-${item.id}`}
                  categories={categories}
                  defaultValue={item.categoryId}
                  onChange={(id) => id && onRecategorize(id)}
                />
              </Field>

              <Field label={t("account")}>
                <div className="border-border bg-card flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: acc?.color ?? "var(--ink-3)" }}
                  />
                  <span>{acc?.name}</span>
                  <span className="flex-1" />
                  {acc?.bankName && (
                    <span className="text-muted-foreground text-xs">{acc.bankName}</span>
                  )}
                </div>
              </Field>

              <Field label={t("type")}>
                <Pill>{t(`types.${item.type}`)}</Pill>
              </Field>

              <Field label={t("originalLabel")}>
                <div className="border-border bg-muted rounded-lg border px-3 py-2.5 font-mono text-xs break-words">
                  {item.rawLabel}
                </div>
              </Field>

              <Field label={t("note")}>
                <div className="text-muted-foreground border-border rounded-lg border border-dashed px-3 py-2.5 text-sm">
                  {item.note || t("notePlaceholder")}
                </div>
              </Field>

              {budgets.length > 0 && (
                <Field label={tb("title")}>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <select
                        aria-label={tb("choose")}
                        value={chosen}
                        onChange={(e) => setChosen(e.target.value)}
                        className="border-input bg-background h-9 min-w-0 flex-1 rounded-md border px-3 text-sm"
                      >
                        <option value="">{tb("choose")}</option>
                        {budgets.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!chosen}
                        onClick={() => assign("INCLUDE")}
                      >
                        {tb("include")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!chosen}
                        onClick={() => assign("EXCLUDE")}
                      >
                        {tb("exclude")}
                      </Button>
                    </div>

                    {Object.keys(assignments).length > 0 && (
                      <ul className="space-y-1.5">
                        {budgets
                          .filter((b) => assignments[b.id])
                          .map((b) => (
                            <li
                              key={b.id}
                              className="border-border flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                            >
                              <span className="min-w-0 flex-1 truncate">{b.name}</span>
                              <Badge
                                variant={assignments[b.id] === "EXCLUDE" ? "outline" : "secondary"}
                              >
                                {tb(`mode${assignments[b.id]}`)}
                              </Badge>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => unassign(b.id)}
                              >
                                {tb("remove")}
                              </Button>
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                </Field>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
