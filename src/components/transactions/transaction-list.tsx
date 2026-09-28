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
};

export type AccountOption = {
  id: string;
  name: string;
  color: string | null;
  bankName: string | null;
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
  accounts,
  budgets = [],
  partialLastDay = false,
}: {
  items: ListItem[];
  categories: FlatCategory[];
  accounts: AccountOption[];
  budgets?: AssignableBudget[];
  partialLastDay?: boolean;
}) {
  const t = useTranslations("transactions");
  const locale = useLocale();
  const router = useRouter();
  const isMobile = useIsMobile();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [rule, setRule] = useState<{
    pattern: string;
    categoryId: string;
    categoryName: string;
    categoryColor: string | null;
  } | null>(null);

  const tLink = useTranslations("transactions.link");
  const [linkMode, setLinkMode] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [linkPending, startLinkTransition] = useTransition();

  function togglePicked(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submitLink(formData: FormData) {
    startLinkTransition(async () => {
      const r = await createLinkAction(null, formData);
      if (r?.ok) {
        setPicked(new Set());
        setLinkMode(false);
        router.refresh();
      }
    });
  }

  const catMeta = categoryIndex(categories);
  const accMeta: Record<string, AccountMeta> = Object.fromEntries(
    accounts.map((a) => [a.id, { name: a.name, color: a.color, bankName: a.bankName }]),
  );

  if (items.length === 0) return <p className="text-muted-foreground text-sm">{t("empty")}</p>;

  const nf = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
  const dfDay = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" });
  const dfShort = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit" });
  const signed = (n: number) => (n > 0 ? `+${nf.format(n)}` : nf.format(n));

  // Group by ISO day (items already newest-first).
  const groups: { day: string; rows: ListItem[]; total: number }[] = [];
  for (const it of items) {
    const day = it.date.slice(0, 10);
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
      if (r?.ok) {
        router.refresh();
        const pattern = proposePattern(it.rawLabel || it.label);
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
      }
    : null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            setLinkMode((v) => !v);
            setPicked(new Set());
          }}
          aria-pressed={linkMode}
          className="border-border text-muted-foreground hover:text-foreground inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[0.8rem]"
        >
          {linkMode ? tLink("exit") : tLink("mode")}
        </button>
        {linkMode && (
          <form action={submitLink} className="flex items-center gap-2">
            <input type="hidden" name="transactionIds" value={[...picked].join(",")} />
            <span className="text-muted-foreground text-[0.8rem]">
              {tLink("selected", { count: picked.size })}
            </span>
            <button
              type="submit"
              disabled={picked.size < 2 || linkPending}
              className="bg-primary text-primary-foreground inline-flex h-8 items-center rounded-lg px-3 text-[0.8rem] font-medium disabled:opacity-50"
            >
              {tLink("create")}
            </button>
          </form>
        )}
      </div>
      {linkMode && <p className="text-muted-foreground text-xs">{tLink("hint")}</p>}

      {/* Desktop column header */}
      <div className="overflow-hidden rounded-xl border">
        <div
          className={`text-muted-foreground bg-muted/60 hidden gap-3 border-b px-4 py-2.5 text-[0.65rem] tracking-[0.08em] uppercase md:grid ${"md:grid-cols-[64px_1fr_minmax(0,180px)_minmax(0,140px)_92px_110px]"}`}
        >
          <span>{t("date")}</span>
          <span>{t("label")}</span>
          <span>{t("category")}</span>
          <span>{t("account")}</span>
          <span>{t("type")}</span>
          <span className="text-right">{t("amount")}</span>
        </div>

        {groups.map((g, gi) => (
          <div key={g.day}>
            <div className="text-muted-foreground bg-muted/60 flex items-center justify-between border-y px-4 py-2 text-[0.7rem] font-medium tracking-[0.08em] uppercase">
              <span>{dfDay.format(new Date(g.day))}</span>
              {/* The per-day total only adds signal when a day has several rows;
                  for single-transaction days it would just echo the amount. */}
              {g.rows.length > 1 && !(partialLastDay && gi === groups.length - 1) && (
                <span className="tabular-nums">{signed(g.total)}</span>
              )}
            </div>

            {g.rows.map((it) => {
              const meta = it.categoryId ? catMeta[it.categoryId] : undefined;
              const isSel = it.id === selectedId;
              return (
                <button
                  key={it.id}
                  type="button"
                  data-slot="transaction-row"
                  onClick={() => (linkMode ? togglePicked(it.id) : setSelectedId(it.id))}
                  aria-pressed={linkMode ? picked.has(it.id) : undefined}
                  data-selected={linkMode && picked.has(it.id) ? "true" : undefined}
                  className={`w-full border-b text-left transition-colors last:border-b-0 ${isSel ? "bg-accent" : "hover:bg-muted/50"} ${linkMode && picked.has(it.id) ? "ring-primary ring-2 ring-inset" : ""}`}
                >
                  {/* Desktop grid */}
                  <span className="hidden items-center gap-3 px-4 py-2.5 md:grid md:grid-cols-[64px_1fr_minmax(0,180px)_minmax(0,140px)_92px_110px]">
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {dfShort.format(new Date(it.date))}
                    </span>
                    <span className="flex min-w-0 items-center gap-2.5">
                      <CategoryAvatar color={meta?.color} icon={meta?.icon} size={26} />
                      <span className="truncate text-sm">{it.label}</span>
                      {it.linked && <Pill>{tLink("linked")}</Pill>}
                    </span>
                    <span className="min-w-0">
                      {meta ? (
                        <CategoryChip name={meta.name} color={meta.color} />
                      ) : (
                        <span className="text-muted-foreground text-xs">{t("noCategory")}</span>
                      )}
                    </span>
                    <span className="text-muted-foreground truncate text-xs">{it.accountName}</span>
                    <span>
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
                  <span className="flex items-center gap-3 px-4 py-3 md:hidden">
                    <CategoryAvatar color={meta?.color} icon={meta?.icon} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm">{it.label}</span>
                        {it.linked && <Pill>{tLink("linked")}</Pill>}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
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
        budgets={budgets}
        side={isMobile ? "bottom" : "right"}
        onClose={() => setSelectedId(null)}
        onRecategorize={(categoryId) => selected && recategorize(selected, categoryId)}
      />

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
