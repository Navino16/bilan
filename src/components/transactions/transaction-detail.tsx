"use client";

import { useEffect, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  assignTransactionAction,
  unassignTransactionAction,
  listAssignmentsForTxAction,
} from "@/server/transport/actions/budgets";
import { deleteLinkAction, getLinkSummaryAction } from "@/server/transport/actions/links";
import { type FlatCategory } from "./category-tree";
import type { CategoryMeta } from "./category-tree";
import { CategoryCombobox } from "./category-combobox";
import { Pill, overline } from "./bits";
import { TransactionEditForm } from "./transaction-edit-form";
import { AssignedMonthBadge, AssignedMonthField } from "./assigned-month";
import { useLinkErrorMessage } from "./link-error";
import { NativeSelect } from "@/components/ui/native-select";
import { Link2, Pencil, Trash2, Unlink } from "lucide-react";
import { formatPeriodLabel } from "@/lib/period";
import { formatDate, formatLongDay } from "@/lib/format";
import { editScope } from "@/lib/transaction-edit";
import type { AssignableBudget, TxAssignment } from "@/server/services/budgets";
import type { LinkSummary } from "@/server/services/links";

export type DetailItem = {
  id: string;
  date: string;
  periodDate: string;
  periodManual: boolean;
  amount: number;
  type: string;
  label: string;
  rawLabel: string;
  note: string | null;
  accountId: string;
  categoryId: string | null;
  imported: boolean;
  linked: boolean;
};

export type AccountMeta = {
  name: string;
  color: string | null;
  bankName: string | null;
  writable: boolean;
  archived: boolean;
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
  onLinkFrom,
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
  onLinkFrom?: () => void;
}) {
  const t = useTranslations("transactions");
  const tBudgets = useTranslations("budgets");
  const tb = useTranslations("budgets.assign");
  const td = useTranslations("transactions.delete");
  const tLink = useTranslations("transactions.link");
  const linkErrorMessage = useLinkErrorMessage();
  const locale = useLocale();
  const router = useRouter();

  const [loadedAssignments, setAssignments] = useState<{ txId: string; rows: TxAssignment[] }>({
    txId: "",
    rows: [],
  });
  const [chosen, setChosen] = useState("");
  const [, startAssign] = useTransition();
  // Keyed by transaction id so switching rows needs no reset effect.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [link, setLink] = useState<{ txId: string; summary: LinkSummary | null } | null>(null);
  const [unlinkError, setUnlinkError] = useState<{ txId: string; message: string } | null>(null);
  const [unlinking, startUnlink] = useTransition();

  const linkedId = item?.linked ? item.id : undefined;
  const itemLabel = item?.label;
  const itemAmount = item?.amount;
  useEffect(() => {
    if (!linkedId) return;
    let active = true;
    getLinkSummaryAction(linkedId).then((summary) => {
      if (active) setLink({ txId: linkedId, summary });
    });
    return () => {
      active = false;
    };
  }, [linkedId, itemLabel, itemAmount]);

  function unlink(txId: string, linkId: string) {
    const fd = new FormData();
    fd.set("linkId", linkId);
    setUnlinkError(null);
    startUnlink(async () => {
      const r = await deleteLinkAction(null, fd);
      if (r?.ok) return router.refresh();
      const message =
        r?.error === "FORBIDDEN"
          ? linkErrorMessage(r.error)
          : r?.error === "NOT_FOUND"
            ? tLink("unlinkGone")
            : tLink("unlinkFailed");
      setUnlinkError({ txId, message });
      if (r?.error === "NOT_FOUND") router.refresh();
    });
  }

  // Lazily load which budgets this transaction is assigned to when the panel opens,
  // even with no assignable budget: an assignment to an archived one stays removable.
  // Only the async result sets state (a synchronous reset here would trip
  // react-hooks/set-state-in-effect); rows of another transaction are ignored.
  const itemId = item?.id;
  useEffect(() => {
    if (!itemId) return;
    let active = true;
    listAssignmentsForTxAction(itemId).then((rows) => {
      if (active) setAssignments({ txId: itemId, rows });
    });
    return () => {
      active = false;
    };
  }, [itemId]);
  const assignments = loadedAssignments.txId === itemId ? loadedAssignments.rows : [];

  function refreshAssignments(txId: string) {
    listAssignmentsForTxAction(txId).then((rows) => setAssignments({ txId, rows }));
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
  const editing = !!item && editingId === item.id && !!acc?.writable;
  const limitedBy =
    item && editScope({ imported: item.imported, archived: !!acc?.archived }) === "text"
      ? item.imported
        ? "imported"
        : "archived"
      : null;
  const linkSummary = item?.linked && link?.txId === item.id ? link.summary : null;

  return (
    <Sheet
      open={!!item}
      onOpenChange={(o) => {
        if (o) return;
        setEditingId(null);
        onClose();
      }}
    >
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
              <SheetTitle className="font-sans text-sm font-normal">{item.label}</SheetTitle>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground text-xs first-letter:uppercase">
                  {formatLongDay(item.date, locale)}
                </span>
                <AssignedMonthBadge date={item.date} periodDate={item.periodDate} />
              </div>
              {acc?.writable && !editing && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() => setEditingId(item.id)}
                >
                  <Pencil />
                  {t("edit")}
                </Button>
              )}
            </div>

            {editing ? (
              <div className="px-6 py-6">
                <div className={`${overline} mb-4`}>{t("editTitle")}</div>
                <TransactionEditForm
                  key={item.id}
                  item={item}
                  limitedBy={limitedBy}
                  onCancel={() => setEditingId(null)}
                  onSaved={() => {
                    setEditingId(null);
                    router.refresh();
                  }}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-5 px-6 py-6">
                <Field label={t("category")}>
                  {acc?.writable ? (
                    <CategoryCombobox
                      key={`${item.id}-${item.categoryId}-${categoryAttempt}`}
                      name={`detail-cat-${item.id}`}
                      aria-label={t("category")}
                      categories={categories}
                      defaultValue={item.categoryId}
                      unlisted={category}
                      onChange={onRecategorize}
                    />
                  ) : (
                    <div
                      data-slot="category-readonly"
                      className="border-border bg-muted/40 flex h-8 items-center gap-2 rounded-lg border px-2.5 text-sm"
                    >
                      {category && (
                        <span
                          aria-hidden
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ background: category.color ?? "var(--cat-other)" }}
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

                {acc?.writable && (
                  <Field label={t("assignedMonth")}>
                    <AssignedMonthField
                      id={item.id}
                      periodDate={item.periodDate}
                      periodManual={item.periodManual}
                    />
                  </Field>
                )}

                <Field label={t("account")}>
                  <div className="border-border bg-card flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm">
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: acc?.color ?? "var(--cat-other)" }}
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
                  <div
                    className={`bg-muted/40 rounded-lg px-3 py-2.5 text-sm break-words ${item.note ? "" : "text-muted-foreground"}`}
                  >
                    {item.note || t("notePlaceholder")}
                  </div>
                </Field>

                {!item.linked && acc?.writable && onLinkFrom && (
                  <Field label={tLink("field")}>
                    <Button type="button" variant="outline" className="w-full" onClick={onLinkFrom}>
                      <Link2 />
                      {tLink("startFrom")}
                    </Button>
                  </Field>
                )}
                {linkSummary && (
                  <Field label={tLink("linkedTo")}>
                    <div data-slot="link-summary" className="space-y-2">
                      <ul className="space-y-1.5">
                        {linkSummary.others.map((o) => (
                          <li
                            key={o.id}
                            className="border-border flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">{o.label}</span>
                              <span className="text-muted-foreground block truncate text-xs">
                                {o.accountName} · {formatDate(o.date, locale)}
                              </span>
                            </span>
                            <span
                              className="tabular-nums"
                              style={o.amount > 0 ? { color: "var(--income)" } : undefined}
                            >
                              {nf.format(o.amount)}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {linkSummary.hiddenCount > 0 && (
                        <p className="text-muted-foreground text-xs">
                          {tLink("hiddenMembers", { count: linkSummary.hiddenCount })}
                        </p>
                      )}
                      {linkSummary.canUnlink ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={unlinking}
                          onClick={() => unlink(item.id, linkSummary.linkId)}
                        >
                          <Unlink />
                          {tLink("unlink")}
                        </Button>
                      ) : (
                        <p className="text-muted-foreground text-xs">{tLink("unlinkNeedsWrite")}</p>
                      )}
                      {unlinkError?.txId === item.id && (
                        <p role="alert" className="text-destructive text-xs">
                          {unlinkError.message}
                        </p>
                      )}
                    </div>
                  </Field>
                )}

                {(budgets.length > 0 || assignments.length > 0) && (
                  <Field label={tb("title")}>
                    <div className="space-y-2">
                      {budgets.length > 0 && (
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
                      )}

                      {assignments.length > 0 && (
                        <ul className="space-y-1.5">
                          {assignments.map(({ budget: b, mode }) => (
                            <li
                              key={b.id}
                              data-slot="budget-assignment"
                              className="border-border flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                            >
                              <span className="min-w-0 flex-1 truncate">
                                {budgetLabel(b)}
                                {b.groupName && (
                                  <span className="text-muted-foreground"> · {b.groupName}</span>
                                )}
                              </span>
                              {b.archived && (
                                <Badge variant="outline">{tBudgets("archivedBadge")}</Badge>
                              )}
                              <Badge variant={mode === "EXCLUDE" ? "outline" : "secondary"}>
                                {tb(`mode${mode as "INCLUDE" | "EXCLUDE"}`)}
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
            )}

            {acc?.writable && !editing && (
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
