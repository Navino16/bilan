import { round2 } from "@/lib/budgets";
import { merchantKey, merchantLabel } from "@/lib/merchant";

export type CategoryChange = {
  categoryId: string | null;
  current: number;
  previous: number;
  diff: number;
};
// `label` is what is shown (the alias, else the latest bank label); `search` stays a bank
// label so the transactions link still matches; `keys` are the merchant keys grouped.
export type MerchantTotal = {
  label: string;
  search: string;
  keys: string[];
  alias: string | null;
  total: number;
  count: number;
  categoryId: string | null;
};
export type MerchantAliasGroup = { name: string; keys: string[] };
export type MerchantDirectory = { renamed: MerchantTotal[]; others: MerchantTotal[] };
export type IncomeByCategory = { categoryId: string | null; current: number; previous: number };
export type InsightsData = {
  changes: CategoryChange[];
  merchants: MerchantTotal[];
  aliasGroups: MerchantAliasGroup[];
  income: IncomeByCategory[];
  incomeTotal: number;
};

export type HistoryMonth = { year: number; month: number };
export type CategorySeries = { categoryId: string | null; values: number[] };
// Monthly spending per category, oldest month first. `inProgress` flags the last month as partial.
// `dataStart` is the index of the first month with any transaction: the months
// before it are empty because nothing was recorded yet, not because nothing was spent.
export type CategoryHistory = {
  months: HistoryMonth[];
  inProgress: boolean;
  dataStart: number;
  series: CategorySeries[];
};
export type HistoryRow = CategorySeries & { total: number; average: number };

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

export function monthlyCategoryTotals(
  rows: (AmountRow & { date: Date })[],
  months: HistoryMonth[],
): CategorySeries[] {
  const index = new Map(months.map((m, i) => [m.year * 12 + m.month - 1, i]));
  const out = new Map<string | null, number[]>();
  for (const r of rows) {
    if (r.amount >= 0) continue;
    const i = index.get(r.date.getUTCFullYear() * 12 + r.date.getUTCMonth());
    if (i === undefined) continue;
    const values = out.get(r.categoryId) ?? months.map(() => 0);
    values[i] -= r.amount;
    out.set(r.categoryId, values);
  }
  return [...out.entries()]
    .map(([categoryId, values]) => ({ categoryId, values: values.map(round2) }))
    .sort((a, b) => byId(a.categoryId, b.categoryId));
}

// Rows of an N-month window as one "average month": each amount weighs 1/N. `lastDay`
// keeps only days 1..lastDay of each month, to match a month in progress.
export function averageMonthRows(
  rows: (AmountRow & { date: Date })[],
  months: number,
  lastDay: number | null,
): AmountRow[] {
  return rows
    .filter((r) => lastDay === null || r.date.getUTCDate() <= lastDay)
    .map((r) => ({ amount: r.amount / months, categoryId: r.categoryId }));
}

// The average covers whole months since the first transaction only: the month in
// progress and the months before any data would drag it down.
export function historyRows(
  history: CategoryHistory,
  count: number,
  limit: number,
): { months: HistoryMonth[]; rows: HistoryRow[] } {
  const start = Math.max(0, history.months.length - count);
  const skip = Math.max(0, history.dataStart - start);
  const rows = history.series
    .map(({ categoryId, values }) => {
      const shown = values.slice(start);
      const whole = (history.inProgress ? shown.slice(0, -1) : shown).slice(skip);
      return {
        categoryId,
        values: shown,
        total: round2(shown.reduce((s, v) => s + v, 0)),
        average: whole.length ? round2(whole.reduce((s, v) => s + v, 0) / whole.length) : 0,
      };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total || byId(a.categoryId, b.categoryId))
    .slice(0, limit);
  return { months: history.months.slice(start), rows };
}

type MerchantGroup = {
  alias: string | null;
  keys: Set<string>;
  total: number;
  count: number;
  latest: MerchantRow;
  byCategory: Map<string | null, { count: number; total: number }>;
};

// Transfers are excluded: unlinked internal moves ("VIR LIVRET A") would top the list.
// Merchants sharing an alias (merchant key → display name) are summed as one.
export function topMerchants(
  rows: MerchantRow[],
  limit: number,
  aliases: ReadonlyMap<string, string> = new Map(),
): MerchantTotal[] {
  const groups = new Map<string, MerchantGroup>();
  for (const r of rows) {
    if (r.amount >= 0 || r.type === "TRANSFER") continue;
    const key = merchantKey(r.label);
    if (!key) continue;
    const alias = aliases.get(key) ?? null;
    const id = alias === null ? `k:${key}` : `a:${alias.toLocaleLowerCase()}`;
    const spend = -r.amount;
    const g: MerchantGroup = groups.get(id) ?? {
      alias,
      keys: new Set<string>(),
      total: 0,
      count: 0,
      latest: r,
      byCategory: new Map(),
    };
    g.keys.add(key);
    g.total += spend;
    g.count += 1;
    if (r.date > g.latest.date) g.latest = r;
    const c = g.byCategory.get(r.categoryId) ?? { count: 0, total: 0 };
    c.count += 1;
    c.total += spend;
    g.byCategory.set(r.categoryId, c);
    groups.set(id, g);
  }
  return [...groups.values()]
    .map((g) => {
      const [categoryId] = [...g.byCategory.entries()].reduce((a, e) =>
        e[1].count > a[1].count || (e[1].count === a[1].count && e[1].total > a[1].total) ? e : a,
      );
      const search = merchantLabel(g.latest.label);
      return {
        label: g.alias ?? search,
        search,
        keys: [...g.keys].sort(),
        alias: g.alias,
        total: round2(g.total),
        count: g.count,
        categoryId,
      };
    })
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
    .slice(0, limit);
}
