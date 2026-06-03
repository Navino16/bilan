"use client";

import { useEffect, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { CategoryAvatar, CategoryChip, Pill } from "./bits";
import { type FlatCategory } from "./category-picker";
import { categoryIndex } from "./category-tree";
import { CreateRuleDialog } from "./create-rule-dialog";
import { TransactionDetail, type AccountMeta, type DetailItem } from "./transaction-detail";
import { recategorizeTransactionAction } from "@/server/transport/actions/transactions";

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

// Switches the detail Sheet between a right-side panel (desktop) and a bottom
// sheet (mobile). Resolved after mount, so it never causes a hydration mismatch
// (the Sheet only opens on a post-hydration click).
function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return mobile;
}

export function TransactionList({
  items,
  categories,
  accounts,
}: {
  items: ListItem[];
  categories: FlatCategory[];
  accounts: AccountOption[];
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
    g.total += it.amount;
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

        {groups.map((g) => (
          <div key={g.day}>
            <div className="text-muted-foreground bg-muted/60 flex items-center justify-between border-y px-4 py-2 text-[0.7rem] font-medium tracking-[0.08em] uppercase">
              <span>{dfDay.format(new Date(g.day))}</span>
              {/* The per-day total only adds signal when a day has several rows;
                  for single-transaction days it would just echo the amount. */}
              {g.rows.length > 1 && <span className="tabular-nums">{signed(g.total)}</span>}
            </div>

            {g.rows.map((it) => {
              const meta = it.categoryId ? catMeta[it.categoryId] : undefined;
              const isSel = it.id === selectedId;
              return (
                <button
                  key={it.id}
                  type="button"
                  data-slot="transaction-row"
                  onClick={() => setSelectedId(it.id)}
                  className={`w-full border-b text-left transition-colors last:border-b-0 ${isSel ? "bg-accent" : "hover:bg-muted/50"}`}
                >
                  {/* Desktop grid */}
                  <span className="hidden items-center gap-3 px-4 py-2.5 md:grid md:grid-cols-[64px_1fr_minmax(0,180px)_minmax(0,140px)_92px_110px]">
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {dfShort.format(new Date(it.date))}
                    </span>
                    <span className="flex min-w-0 items-center gap-2.5">
                      <CategoryAvatar color={meta?.color} icon={meta?.icon} size={26} />
                      <span className="truncate text-sm">{it.label}</span>
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
                      <span className="block truncate text-sm">{it.label}</span>
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
