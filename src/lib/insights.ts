import { round2 } from "@/lib/budgets";
import { merchantKey, merchantLabel } from "@/lib/merchant";

export type CategoryChange = {
  categoryId: string | null;
  current: number;
  previous: number;
  diff: number;
};
export type MerchantTotal = {
  label: string;
  total: number;
  count: number;
  categoryId: string | null;
};
export type IncomeByCategory = { categoryId: string | null; current: number; previous: number };
export type InsightsData = {
  changes: CategoryChange[];
  merchants: MerchantTotal[];
  income: IncomeByCategory[];
  incomeTotal: number;
};

export type AmountRow = { amount: number; categoryId: string | null };
export type MerchantRow = AmountRow & { label: string; date: Date; type: string };

function sumByCategory(rows: AmountRow[], side: "expense" | "income"): Map<string | null, number> {
  const out = new Map<string | null, number>();
  for (const r of rows) {
    if (side === "expense" ? r.amount >= 0 : r.amount <= 0) continue;
    out.set(r.categoryId, (out.get(r.categoryId) ?? 0) + Math.abs(r.amount));
  }
  return out;
}

const byId = (a: string | null, b: string | null) => (a ?? "").localeCompare(b ?? "");

export function categoryChanges(current: AmountRow[], previous: AmountRow[]): CategoryChange[] {
  const cur = sumByCategory(current, "expense");
  const prev = sumByCategory(previous, "expense");
  return [...new Set([...cur.keys(), ...prev.keys()])]
    .map((categoryId) => {
      const c = round2(cur.get(categoryId) ?? 0);
      const p = round2(prev.get(categoryId) ?? 0);
      return { categoryId, current: c, previous: p, diff: round2(c - p) };
    })
    .filter((x) => x.diff !== 0)
    .sort(
      (a, b) =>
        Math.abs(b.diff) - Math.abs(a.diff) ||
        b.current - a.current ||
        byId(a.categoryId, b.categoryId),
    );
}

export function incomeByCategory(current: AmountRow[], previous: AmountRow[]): IncomeByCategory[] {
  const cur = sumByCategory(current, "income");
  const prev = sumByCategory(previous, "income");
  return [...cur.entries()]
    .map(([categoryId, amount]) => ({
      categoryId,
      current: round2(amount),
      previous: round2(prev.get(categoryId) ?? 0),
    }))
    .sort((a, b) => b.current - a.current || byId(a.categoryId, b.categoryId));
}

type MerchantGroup = {
  total: number;
  count: number;
  latest: MerchantRow;
  byCategory: Map<string | null, { count: number; total: number }>;
};

// Transfers are excluded: unlinked internal moves ("VIR LIVRET A") would top the list.
export function topMerchants(rows: MerchantRow[], limit: number): MerchantTotal[] {
  const groups = new Map<string, MerchantGroup>();
  for (const r of rows) {
    if (r.amount >= 0 || r.type === "TRANSFER") continue;
    const key = merchantKey(r.label);
    if (!key) continue;
    const spend = -r.amount;
    const g = groups.get(key) ?? { total: 0, count: 0, latest: r, byCategory: new Map() };
    g.total += spend;
    g.count += 1;
    if (r.date > g.latest.date) g.latest = r;
    const c = g.byCategory.get(r.categoryId) ?? { count: 0, total: 0 };
    c.count += 1;
    c.total += spend;
    g.byCategory.set(r.categoryId, c);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => {
      const [categoryId] = [...g.byCategory.entries()].reduce((a, e) =>
        e[1].count > a[1].count || (e[1].count === a[1].count && e[1].total > a[1].total) ? e : a,
      );
      return {
        label: merchantLabel(g.latest.label),
        total: round2(g.total),
        count: g.count,
        categoryId,
      };
    })
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
    .slice(0, limit);
}
