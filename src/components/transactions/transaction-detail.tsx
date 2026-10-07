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
import type { CategoryMeta } from "./category-tree";
import { CategoryCombobox } from "./category-combobox";
import { Pill, overline } from "./bits";
import { NativeSelect } from "@/components/ui/native-select";
import { Trash2 } from "lucide-react";
import { formatPeriodLabel } from "@/lib/period";
import type { AssignableBudget } from "@/server/services/budgets";

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

export type AccountMeta = {
  name: string;
  color: string | null;
  bankName: string | null;
  writable: boolean;
};
export type { AssignableBudget };

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
  categoryMeta,
  categoryError = false,
  categoryAttempt = 0,
  budgets = [],
  side,
  onClose,
  onRecategorize,
  onDelete,
}: {
  item: DetailItem | null;
  accounts: Record<string, AccountMeta>;
  categories: FlatCategory[];
  // Every category a row may carry, including the owner's on a shared account.
  categoryMeta: Record<string, CategoryMeta>;
  categoryError?: boolean;
  // Bumped on each failed change, so the picker goes back to the saved value.
  categoryAttempt?: number;
  budgets?: AssignableBudget[];
  side: "right" | "bottom";
  onClose: () => void;
  onRecategorize: (categoryId: string) => void;
  onDelete: () => void;
}) {
  const t = useTranslations("transactions");
  const tBudgets = useTranslations("budgets");
  const tb = useTranslations("budgets.assign");
  const td = useTranslations("transactions.delete");
  const locale = useLocale();

  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [chosen, setChosen] = useState("");
  const [, startAssign] = useTransition();

  // Lazily load which budgets this transaction is assigned to when the panel opens.
  // Only the async result sets state (a synchronous reset here would trip
  // react-hooks/set-state-in-effect); the section isn't rendered without an item.
  const itemId = item?.id;
  useEffect(() => {
    if (!itemId || budgets.length === 0) return;
    let active = true;
    listAssignmentsForTxAction(itemId).then((rows) => {
      if (active) setAssignments(Object.fromEntries(rows.map((r) => [r.budgetId, r.mode])));
    });
    return () => {
      active = false;
    };
  }, [itemId, budgets.length]);

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
    timeZone: "UTC",
  });
  // Same-named budgets differ by owner and period (#161).
  const budgetLabel = (b: AssignableBudget) =>
    `${b.name} · ${formatPeriodLabel({ from: b.periodStart, to: b.periodEnd, year: null, month: null }, locale)}`;
  const budgetGroups = new Map<string, AssignableBudget[]>();
  for (const b of budgets) {
    const key = b.groupId ?? "";
    budgetGroups.set(key, [...(budgetGroups.get(key) ?? []), b]);
  }

  const acc = item ? accounts[item.accountId] : undefined;
  const category = item?.categoryId ? categoryMeta[item.categoryId] : undefined;

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
              <div className="text-muted-foreground text-xs first-letter:uppercase">
                {df.format(new Date(item.date))}
              </div>
            </div>

            <div className="flex flex-col gap-5 px-6 py-6">
              <Field label={t("category")}>
                {acc?.writable ? (
                  <CategoryCombobox
                    key={`${item.id}-${item.categoryId}-${categoryAttempt}`}
                    name={`detail-cat-${item.id}`}
                    categories={categories}
                    defaultValue={item.categoryId}
                    unlisted={category}
                    onChange={onRecategorize}
                  />
                ) : (
                  <div
                    data-slot="category-readonly"
                    className="border-border bg-muted/40 flex h-9 items-center gap-2 rounded-md border px-3 text-sm"
                  >
                    {category && (
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: category.color ?? "var(--ink-3)" }}
                      />
                    )}
                    <span className="flex-1 truncate">{category?.name ?? t("noCategory")}</span>
                    <span className="text-muted-foreground text-xs">{t("readOnly")}</span>
                  </div>
                )}
                {categoryError && (
                  <p role="alert" className="text-destructive text-xs">
                    {t("recategorizeFailed")}
                  </p>
                )}
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
                      <NativeSelect
                        aria-label={tb("choose")}
                        value={chosen}
                        onChange={(e) => setChosen(e.target.value)}
                        className="min-w-0 flex-1"
                      >
                        <option value="">{tb("choose")}</option>
                        {[...budgetGroups].map(([groupId, list]) => (
                          <optgroup
                            key={groupId}
                            label={list[0].groupName ?? tBudgets("scopePersonal")}
                          >
                            {list.map((b) => (
                              <option key={b.id} value={b.id}>
                                {budgetLabel(b)}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </NativeSelect>
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
                              <span className="min-w-0 flex-1 truncate">
                                {budgetLabel(b)}
                                {b.groupName && (
                                  <span className="text-muted-foreground"> · {b.groupName}</span>
                                )}
                              </span>
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

            {acc?.writable && (
              <div className="border-border bg-card sticky bottom-0 mt-auto border-t px-6 pt-3 pb-4">
                <Button
                  type="button"
                  variant="outline"
                  className="text-destructive hover:text-destructive h-10 w-full"
                  onClick={onDelete}
                >
                  <Trash2 />
                  {td("detailAction")}
                </Button>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
