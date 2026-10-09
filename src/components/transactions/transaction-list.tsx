"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { CategoryAvatar, CategoryChip, Pill } from "./bits";
import { type FlatCategory } from "./category-picker";
import { categoryIndex } from "./category-tree";
import { CreateRuleDialog } from "./create-rule-dialog";
import {
  TransactionDetail,
  type AccountMeta,
  type DetailItem,
  type AssignableBudget,
} from "./transaction-detail";
import { recategorizeTransactionAction } from "@/server/transport/actions/transactions";
import { createLinkAction } from "@/server/transport/actions/links";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useSelectionMode } from "./selection-mode";
import { SelectionBar } from "./selection-bar";
import { DeleteTransactionsDialog } from "./delete-transactions-dialog";
import { MIN_SEARCH_WORD } from "@/lib/text";
import { proposeRule } from "@/lib/propose-rule";
import { formatDate } from "@/lib/format";
import { useLinkErrorMessage } from "./link-error";

export type ListItem = {
  id: string;
  date: string; // ISO
  amount: number;
  type: string;
  label: string;
  rawLabel: string;
  note: string | null;
  accountId: string;
  accountName: string;
  categoryId: string | null;
  linked: boolean;
  imported: boolean;
};

export type AccountOption = {
  id: string;
  name: string;
  color: string | null;
  bankName: string | null;
  writable: boolean;
  archived: boolean;
};

// No date column: rows are grouped under a day header. Beside the sidebar below xl the
// account folds under the label and the type column drops, so the label stays readable.
const COLS =
  "lg:grid-cols-[minmax(0,1fr)_minmax(0,160px)_110px] xl:grid-cols-[minmax(0,1fr)_minmax(0,180px)_minmax(0,140px)_92px_110px]";

export function TransactionList({
  items,
  categories,
  foreignCategories = [],
  accounts,
  budgets = [],
  partialLastDay = false,
  currentYear,
  searching = false,
  groupByDay = true,
}: {
  items: ListItem[];
  categories: FlatCategory[];
  // The owners' categories met on shared accounts: shown, never offered.
  foreignCategories?: FlatCategory[];
  accounts: AccountOption[];
  budgets?: AssignableBudget[];
  partialLastDay?: boolean;
  // Day headers omit the year only for this one.
  currentYear: number;
  searching?: boolean;
  // False for amount sorts: one flat list, each row showing its own date.
  groupByDay?: boolean;
}) {
  const t = useTranslations("transactions");
  const locale = useLocale();
  const router = useRouter();
  const isMobile = useIsMobile();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recatFailedId, setRecatFailedId] = useState<string | null>(null);
  const [recatAttempt, setRecatAttempt] = useState(0);
  const [, startTransition] = useTransition();
  const [rule, setRule] = useState<{
    pattern: string;
    categoryId: string;
    categoryName: string;
    categoryColor: string | null;
  } | null>(null);

  const tLink = useTranslations("transactions.link");
  const linkErrorMessage = useLinkErrorMessage();
  const tSel = useTranslations("transactions.selection");
  const { selecting, picked, setSelecting, togglePicked } = useSelectionMode();
  // Picks survive filter changes (the provider sits above the list): act on visible rows only.
  const pickedIds = items.filter((i) => picked.has(i.id)).map((i) => i.id);
  const [linkPending, startLinkTransition] = useTransition();
  // Tied to the picks it was raised for, so changing the selection clears it.
  const [linkError, setLinkError] = useState<{ ids: string; message: string } | null>(null);
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);

  function submitLink() {
    const ids = pickedIds.join(",");
    const fd = new FormData();
    fd.set("transactionIds", ids);
    setLinkError(null);
    startLinkTransition(async () => {
      const r = await createLinkAction(null, fd);
      if (r?.ok) {
        setSelecting(false);
        router.refresh();
      } else {
        setLinkError({ ids, message: linkErrorMessage(r?.error) });
      }
    });
  }

  function onDeleted() {
    setDeleteIds(null);
    setSelectedId(null);
    if (selecting) setSelecting(false);
  }

  const catMeta = categoryIndex([...categories, ...foreignCategories]);
  const accMeta: Record<string, AccountMeta> = Object.fromEntries(
    accounts.map((a) => [
      a.id,
      {
        name: a.name,
        color: a.color,
        bankName: a.bankName,
        writable: a.writable,
        archived: a.archived,
      },
    ]),
  );

  const selectionBar = selecting && (
    <SelectionBar
      count={pickedIds.length}
      linkPending={linkPending}
      error={linkError?.ids === pickedIds.join(",") ? linkError.message : null}
      onExit={() => setSelecting(false)}
      onLink={submitLink}
      onDelete={() => setDeleteIds(pickedIds)}
    />
  );

  if (items.length === 0)
    return (
      <>
        <p className="text-muted-foreground text-sm">
          {searching ? t("emptySearch", { min: MIN_SEARCH_WORD }) : t("empty")}
        </p>
        {selectionBar}
      </>
    );

  const nf = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
  // Rows carry UTC days: format in UTC so every zone (and the SSR pass) shows the same day.
  const dayOpts = { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" } as const;
  const dfDay = new Intl.DateTimeFormat(locale, dayOpts);
  const dfDayYear = new Intl.DateTimeFormat(locale, { ...dayOpts, year: "numeric" });
  const dayLabel = (day: string) =>
    (day.startsWith(String(currentYear)) ? dfDay : dfDayYear).format(new Date(day));
  const signed = (n: number) => (n > 0 ? `+${nf.format(n)}` : nf.format(n));
  const rowDate = (it: ListItem) => (groupByDay ? null : formatDate(it.date, locale));

  // Group by ISO day, in list order; a flat list is one header-less group.
  const groups: { day: string; rows: ListItem[]; total: number }[] = [];
  for (const it of items) {
    const day = groupByDay ? it.date.slice(0, 10) : "";
    let g = groups.find((x) => x.day === day);
    if (!g) {
      g = { day, rows: [], total: 0 };
      groups.push(g);
    }
    g.rows.push(it);
    // Linked rows are excluded from the day subtotal — their net is reflected on
    // the dashboard; showing the gross sum here would double-count refunds.
    if (!it.linked) g.total += it.amount;
  }

  function recategorize(it: ListItem, categoryId: string) {
    const fd = new FormData();
    fd.set("id", it.id);
    fd.set("categoryId", categoryId);
    startTransition(async () => {
      const r = await recategorizeTransactionAction(null, fd);
      setRecatFailedId(r?.ok ? null : it.id);
      if (!r?.ok) setRecatAttempt((n) => n + 1);
      if (r?.ok) {
        router.refresh();
        const pattern = proposeRule(it.rawLabel || it.label)?.pattern;
        const meta = catMeta[categoryId];
        if (pattern && meta) {
          setRule({
            pattern,
            categoryId,
            categoryName: meta.name,
            categoryColor: meta.color,
          });
        }
      }
    });
  }

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const detailItem: DetailItem | null = selected
    ? {
        id: selected.id,
        date: selected.date,
        amount: selected.amount,
        type: selected.type,
        label: selected.label,
        rawLabel: selected.rawLabel,
        note: selected.note,
        accountId: selected.accountId,
        categoryId: selected.categoryId,
        imported: selected.imported,
        linked: selected.linked,
      }
    : null;

  return (
    <div className={`space-y-5 ${selecting ? "pb-20" : ""}`}>
      {/* On mobile, selection mode is entered from the filter sheet. */}
      {!selecting && (
        <div className="hidden lg:flex">
          <button
            type="button"
            onClick={() => setSelecting(true)}
            className="border-border text-muted-foreground hover:text-foreground inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[0.8rem]"
          >
            {tSel("mode")}
          </button>
        </div>
      )}

      {/* Desktop column header */}
      <div className="overflow-hidden rounded-xl border">
        <div
          className={`text-muted-foreground bg-muted/60 hidden gap-3 border-b px-4 py-2.5 text-[0.65rem] tracking-[0.08em] uppercase lg:grid ${COLS}`}
        >
          <span>{t("label")}</span>
          <span>{t("category")}</span>
          <span className="hidden xl:block">{t("account")}</span>
          <span className="hidden xl:block">{t("type")}</span>
          <span className="text-right">{t("amount")}</span>
        </div>

        {groups.map((g, gi) => (
          <div key={g.day}>
            {groupByDay && (
              <div className="text-muted-foreground bg-muted/60 flex items-center justify-between border-y px-4 py-2 text-[0.7rem] font-medium tracking-[0.08em] uppercase">
                <span>{dayLabel(g.day)}</span>
                {/* The per-day total only adds signal when a day has several rows;
                    for single-transaction days it would just echo the amount. */}
                {g.rows.length > 1 && !(partialLastDay && gi === groups.length - 1) && (
                  <span className="tabular-nums">{signed(g.total)}</span>
                )}
              </div>
            )}

            {g.rows.map((it) => {
              const meta = it.categoryId ? catMeta[it.categoryId] : undefined;
              const isSel = it.id === selectedId;
              const locked = selecting && !accMeta[it.accountId]?.writable;
              return (
                <button
                  key={it.id}
                  type="button"
                  data-slot="transaction-row"
                  disabled={locked}
                  onClick={() => (selecting ? togglePicked(it.id) : setSelectedId(it.id))}
                  aria-pressed={selecting ? picked.has(it.id) : undefined}
                  data-selected={selecting && picked.has(it.id) ? "true" : undefined}
                  className={`w-full border-b text-left transition-colors last:border-b-0 ${isSel ? "bg-accent" : "hover:bg-muted/50"} ${selecting && picked.has(it.id) ? "ring-primary ring-2 ring-inset" : ""} ${locked ? "opacity-50" : ""}`}
                >
                  {/* Desktop grid */}
                  <span className={`hidden items-center gap-3 px-4 py-2.5 lg:grid ${COLS}`}>
                    <span data-slot="row-label" className="flex min-w-0 items-center gap-2.5">
                      <CategoryAvatar color={meta?.color} icon={meta?.icon} size={26} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{it.label}</span>
                        {rowDate(it) && (
                          <span className="text-muted-foreground block text-xs">{rowDate(it)}</span>
                        )}
                        <span className="text-muted-foreground block truncate text-xs xl:hidden">
                          {it.accountName}
                        </span>
                      </span>
                      {it.linked && <Pill>{tLink("linked")}</Pill>}
                    </span>
                    <span className="min-w-0">
                      {meta ? (
                        <CategoryChip name={meta.name} color={meta.color} />
                      ) : (
                        <span className="text-muted-foreground text-xs">{t("noCategory")}</span>
                      )}
                    </span>
                    <span className="text-muted-foreground hidden truncate text-xs xl:block">
                      {it.accountName}
                    </span>
                    <span className="hidden xl:block">
                      <Pill>{t(`types.${it.type}`)}</Pill>
                    </span>
                    <span
                      className="text-right text-sm font-medium tabular-nums"
                      style={it.amount > 0 ? { color: "var(--income)" } : undefined}
                    >
                      {nf.format(it.amount)}
                    </span>
                  </span>

                  {/* Mobile compact */}
                  <span className="flex items-center gap-3 px-4 py-3 lg:hidden">
                    <CategoryAvatar color={meta?.color} icon={meta?.icon} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm">{it.label}</span>
                        {it.linked && <Pill>{tLink("linked")}</Pill>}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {rowDate(it) ? `${rowDate(it)} · ` : ""}
                        {meta?.name ? `${meta.name} · ` : ""}
                        {it.accountName}
                      </span>
                    </span>
                    <span
                      className="text-sm font-medium tabular-nums"
                      style={it.amount > 0 ? { color: "var(--income)" } : undefined}
                    >
                      {nf.format(it.amount)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <TransactionDetail
        item={detailItem}
        accounts={accMeta}
        categories={categories}
        categoryMeta={catMeta}
        categoryError={!!selected && recatFailedId === selected.id}
        categoryAttempt={recatAttempt}
        budgets={budgets}
        side={isMobile ? "bottom" : "right"}
        onClose={() => {
          setSelectedId(null);
          setRecatFailedId(null);
        }}
        onRecategorize={(categoryId) => selected && recategorize(selected, categoryId)}
        onDelete={() => selected && setDeleteIds([selected.id])}
      />

      {selectionBar}

      {deleteIds && (
        <DeleteTransactionsDialog
          ids={deleteIds}
          onClose={() => setDeleteIds(null)}
          onDeleted={onDeleted}
        />
      )}

      {rule && (
        <CreateRuleDialog
          open={!!rule}
          onOpenChange={(o) => !o && setRule(null)}
          pattern={rule.pattern}
          categoryId={rule.categoryId}
          categoryName={rule.categoryName}
          categoryColor={rule.categoryColor}
        />
      )}
    </div>
  );
}
