import { round2 } from "@/lib/budgets";
import { merchantKey, merchantLabel } from "@/lib/merchant";
import type { Period } from "@/lib/period";
import type { ExceptionalExpenses } from "@/lib/exceptional";
import type { RecurringPayments } from "@/lib/recurring";

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

export type HistoryMonth = { year: number; month: number };
export type CategorySeries = { categoryId: string | null; values: number[] };
// The charts' months, oldest first. `inProgress` flags the last one as partial. `dataStart` is
// the index of the first month with any transaction: the months before it are empty because
// nothing was recorded yet, not because nothing was spent.
export type HistoryWindow = { months: HistoryMonth[]; inProgress: boolean; dataStart: number };

export type MonthFlows = { income: number; expense: number };
export type InsightsOverview = HistoryWindow & {
  flows: MonthFlows[];
  // `average`, `complete` and `spendingAbove` cover the complete months since the data starts.
  average: MonthFlows;
  complete: number;
  spendingAbove: number;
  // Income minus spending over every month shown.
  net: number;
};

export type CategoryChange = {
  categoryId: string;
  current: number;
  reference: number;
  diff: number;
};
export type CategoryTrend = CategoryChange & {
  values: number[];
  average: number;
  stable: boolean;
  children: CategoryChange[];
};
// Where a category sits: its root, and the root's child holding it (the root itself for a root).
export type CategoryBranch = { root: string; child: string };

export type InsightsData = {
  overview: InsightsOverview;
  categories: CategoryTrend[];
  uncategorized: number;
  // `window` is the span the series were looked for in.
  recurring: RecurringPayments & { window: Period };
  exceptional: ExceptionalExpenses;
  merchants: MerchantTotal[];
  aliasGroups: MerchantAliasGroup[];
  income: IncomeByCategory[];
  incomeTotal: number;
};

export type AmountRow = { amount: number; categoryId: string | null };
export type DatedRow = AmountRow & { date: Date };
export type MerchantRow = AmountRow & { id?: string; label: string; date: Date; type: string };

// Coefficient of variation below which a category is grouped as stable (#420).
export const STABLE_CV = 0.15;
const STABLE_MIN_MONTHS = 3;

function sumByCategory(rows: AmountRow[], side: "expense" | "income"): Map<string | null, number> {
  const out = new Map<string | null, number>();
  for (const r of rows) {
    if (side === "expense" ? r.amount >= 0 : r.amount <= 0) continue;
    out.set(r.categoryId, (out.get(r.categoryId) ?? 0) + Math.abs(r.amount));
  }
  return out;
}

const byId = (a: string | null, b: string | null) => (a ?? "").localeCompare(b ?? "");

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

export function uncategorizedSpending(rows: AmountRow[]): number {
  return round2(sumByCategory(rows, "expense").get(null) ?? 0);
}

function monthIndex(months: HistoryMonth[]): (d: Date) => number | undefined {
  const index = new Map(months.map((m, i) => [m.year * 12 + m.month - 1, i]));
  return (d) => index.get(d.getUTCFullYear() * 12 + d.getUTCMonth());
}

export function monthlyCategoryTotals(rows: DatedRow[], months: HistoryMonth[]): CategorySeries[] {
  const indexOf = monthIndex(months);
  const out = new Map<string | null, number[]>();
  for (const r of rows) {
    if (r.amount >= 0) continue;
    const i = indexOf(r.date);
    if (i === undefined) continue;
    const values = out.get(r.categoryId) ?? months.map(() => 0);
    values[i] -= r.amount;
    out.set(r.categoryId, values);
  }
  return [...out.entries()]
    .map(([categoryId, values]) => ({ categoryId, values: values.map(round2) }))
    .sort((a, b) => byId(a.categoryId, b.categoryId));
}

// The complete months since the data starts: the month in progress and the months before
// any data would drag an average down.
export function completeMonths<T>(values: T[], window: HistoryWindow): T[] {
  return (window.inProgress ? values.slice(0, -1) : values).slice(window.dataStart);
}

export const mean = (values: number[]) =>
  values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;

export function isStable(values: number[]): boolean {
  const m = mean(values);
  if (values.length < STABLE_MIN_MONTHS || m <= 0) return false;
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2))) / m < STABLE_CV;
}

export function insightsOverview(rows: DatedRow[], window: HistoryWindow): InsightsOverview {
  const indexOf = monthIndex(window.months);
  const sums = window.months.map(() => ({ income: 0, expense: 0 }));
  for (const r of rows) {
    const i = indexOf(r.date);
    if (i === undefined) continue;
    if (r.amount >= 0) sums[i].income += r.amount;
    else sums[i].expense -= r.amount;
  }
  const flows = sums.map((f) => ({ income: round2(f.income), expense: round2(f.expense) }));
  const complete = completeMonths(flows, window);
  return {
    ...window,
    flows,
    average: {
      income: round2(mean(complete.map((f) => f.income))),
      expense: round2(mean(complete.map((f) => f.expense))),
    },
    complete: complete.length,
    spendingAbove: complete.filter((f) => f.expense > f.income).length,
    net: round2(flows.reduce((s, f) => s + f.income - f.expense, 0)),
  };
}

function changesOf(
  current: Map<string, number>,
  reference: Map<string, number>,
  ids: Iterable<string>,
): CategoryChange[] {
  return [...ids]
    .map((categoryId) => {
      const c = round2(current.get(categoryId) ?? 0);
      const r = round2(reference.get(categoryId) ?? 0);
      return { categoryId, current: c, reference: r, diff: round2(c - r) };
    })
    .filter((x) => x.current > 0 || x.reference > 0)
    .sort(
      (a, b) =>
        Math.abs(b.diff) - Math.abs(a.diff) ||
        b.current - a.current ||
        a.categoryId.localeCompare(b.categoryId),
    );
}

// Each root category's monthly spending, its subtree summed in.
export function rootSeries(
  history: DatedRow[],
  months: HistoryMonth[],
  branches: ReadonlyMap<string, CategoryBranch>,
): Map<string | null, number[]> {
  const rootOf = (id: string | null) => (id === null ? null : (branches.get(id)?.root ?? null));
  return new Map(
    monthlyCategoryTotals(
      history.map((r) => ({ ...r, categoryId: rootOf(r.categoryId) })),
      months,
    ).map((s) => [s.categoryId, s.values]),
  );
}

// Spending per root category against the reference, biggest change first and the stable ones
// last. Uncategorized rows are left out (spec §5.17).
export function categoryTrends(
  current: AmountRow[],
  reference: AmountRow[],
  history: DatedRow[],
  window: HistoryWindow,
  branches: ReadonlyMap<string, CategoryBranch>,
): CategoryTrend[] {
  const branchOf = (id: string | null) => (id === null ? undefined : branches.get(id));
  const sums = (rows: AmountRow[], key: (b: CategoryBranch) => string) => {
    const out = new Map<string, number>();
    for (const [id, amount] of sumByCategory(rows, "expense")) {
      const b = branchOf(id);
      if (b) out.set(key(b), (out.get(key(b)) ?? 0) + amount);
    }
    return out;
  };
  const rootCur = sums(current, (b) => b.root);
  const rootRef = sums(reference, (b) => b.root);
  const childCur = sums(current, (b) => b.child);
  const childRef = sums(reference, (b) => b.child);
  const childrenOf = new Map<string, Set<string>>();
  for (const b of branches.values()) {
    childrenOf.set(b.root, (childrenOf.get(b.root) ?? new Set()).add(b.child));
  }
  const series = rootSeries(history, window.months, branches);
  const trends = changesOf(rootCur, rootRef, new Set([...rootCur.keys(), ...rootRef.keys()])).map(
    (c) => {
      const values = series.get(c.categoryId) ?? window.months.map(() => 0);
      const complete = completeMonths(values, window);
      return {
        ...c,
        values,
        average: round2(mean(complete)),
        stable: isStable(complete),
        children: changesOf(childCur, childRef, childrenOf.get(c.categoryId) ?? []),
      };
    },
  );
  return [...trends.filter((t) => !t.stable), ...trends.filter((t) => t.stable)];
}

// Rows of an N-month window as one "average month": each amount weighs 1/N. `lastDay`
// keeps only days 1..lastDay of each month, to match a month in progress.
export function averageMonthRows(
  rows: DatedRow[],
  months: number,
  lastDay: number | null,
): AmountRow[] {
  return rows
    .filter((r) => lastDay === null || r.date.getUTCDate() <= lastDay)
    .map((r) => ({ amount: r.amount / months, categoryId: r.categoryId }));
}

// One merchant's spending over some rows: a single row, or rows summed in SQL (#296).
// `label` and `date` are those of the part's latest row; `id` is the row's, for a single row.
export type MerchantPart = {
  id?: string;
  key: string;
  label: string;
  date: Date;
  categoryId: string | null;
  count: number;
  total: number;
};

type MerchantGroup = {
  alias: string | null;
  keys: Set<string>;
  total: number;
  count: number;
  latest: MerchantPart;
  byCategory: Map<string | null, { count: number; total: number }>;
};

// Transfers are excluded: unlinked internal moves ("VIR LIVRET A") would top the list.
// Merchants sharing an alias (merchant key → display name) are summed as one.
export function topMerchants(
  rows: MerchantRow[],
  limit: number,
  aliases: ReadonlyMap<string, string> = new Map(),
): MerchantTotal[] {
  return mergeMerchantParts(merchantParts(rows), limit, aliases);
}

export function merchantParts(rows: MerchantRow[]): MerchantPart[] {
  const parts: MerchantPart[] = [];
  for (const r of rows) {
    if (r.amount >= 0 || r.type === "TRANSFER") continue;
    const key = merchantKey(r.label);
    if (key) {
      parts.push({
        id: r.id,
        key,
        label: r.label,
        date: r.date,
        categoryId: r.categoryId,
        count: 1,
        total: -r.amount,
      });
    }
  }
  return parts;
}

export function mergeMerchantParts(
  parts: MerchantPart[],
  limit: number,
  aliases: ReadonlyMap<string, string> = new Map(),
): MerchantTotal[] {
  const groups = new Map<string, MerchantGroup>();
  for (const p of parts) {
    const alias = aliases.get(p.key) ?? null;
    const id = alias === null ? `k:${p.key}` : `a:${alias.toLocaleLowerCase()}`;
    const g: MerchantGroup = groups.get(id) ?? {
      alias,
      keys: new Set<string>(),
      total: 0,
      count: 0,
      latest: p,
      byCategory: new Map(),
    };
    g.keys.add(p.key);
    g.total += p.total;
    g.count += p.count;
    if (p.date > g.latest.date) g.latest = p;
    const c = g.byCategory.get(p.categoryId) ?? { count: 0, total: 0 };
    c.count += p.count;
    c.total += p.total;
    g.byCategory.set(p.categoryId, c);
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
