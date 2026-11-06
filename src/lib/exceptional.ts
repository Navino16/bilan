import { round2 } from "@/lib/budgets";
import {
  completeMonths,
  mean,
  monthlyCategoryTotals,
  rootSeries,
  type CategoryBranch,
  type DatedRow,
  type HistoryWindow,
  type MerchantRow,
} from "@/lib/insights";
import { merchantKey, merchantLabel } from "@/lib/merchant";

// Rules: spec §5.17.
export const EXCEPTIONAL_MIN_AMOUNT = 50;
// A subcategory with fewer complete months since its first spending is judged against its root.
export const LEAF_MIN_MONTHS = 3;

export type ExceptionalExpense = {
  id: string;
  label: string;
  search: string;
  date: Date;
  categoryId: string | null;
  amount: number;
  // The monthly average it was judged against.
  average: number;
};
export type ExceptionalExpenses = {
  expenses: ExceptionalExpense[];
  total: number;
  // Of the period's spending.
  share: number;
};

// The period's spending rows above their category's monthly average over the history window,
// recurring ones (`recurring` ids) and transfers left out.
export function exceptionalExpenses(
  rows: MerchantRow[],
  history: DatedRow[],
  window: HistoryWindow,
  branches: ReadonlyMap<string, CategoryBranch>,
  recurring: ReadonlySet<string>,
  spending: number,
  aliases: ReadonlyMap<string, string> = new Map(),
): ExceptionalExpenses {
  const none = { expenses: [], total: 0, share: 0 };
  if (completeMonths(window.months, window).length === 0) return none;

  const zeros = window.months.map(() => 0);
  const own = new Map(
    monthlyCategoryTotals(history, window.months).map((s) => [s.categoryId, s.values]),
  );
  const roots = rootSeries(history, window.months, branches);
  const averageOf = (values: number[]) => mean(completeMonths(values, window));
  const monthsSinceFirst = (values: number[]) => {
    const first = values.findIndex((v) => v > 0);
    if (first === -1) return 0;
    return completeMonths(
      values.map((_, i) => i >= first),
      window,
    ).filter(Boolean).length;
  };
  const averages = new Map<string | null, number>();
  const averageFor = (categoryId: string | null) => {
    let average = averages.get(categoryId);
    if (average === undefined) {
      const values = own.get(categoryId) ?? zeros;
      const root = categoryId === null ? undefined : branches.get(categoryId)?.root;
      average =
        root === undefined || monthsSinceFirst(values) >= LEAF_MIN_MONTHS
          ? averageOf(values)
          : averageOf(roots.get(root) ?? zeros);
      averages.set(categoryId, average);
    }
    return average;
  };

  const expenses: ExceptionalExpense[] = [];
  for (const r of rows) {
    if (!r.id || r.amount >= 0 || r.type === "TRANSFER" || recurring.has(r.id)) continue;
    const amount = -r.amount;
    const average = averageFor(r.categoryId);
    if (amount < EXCEPTIONAL_MIN_AMOUNT || amount <= average) continue;
    const search = merchantLabel(r.label) || r.label;
    expenses.push({
      id: r.id,
      label: aliases.get(merchantKey(r.label)) ?? search,
      search,
      date: r.date,
      categoryId: r.categoryId,
      amount: round2(amount),
      average: round2(average),
    });
  }
  expenses.sort(
    (a, b) =>
      b.amount - a.amount || b.date.getTime() - a.date.getTime() || a.label.localeCompare(b.label),
  );
  const total = round2(expenses.reduce((s, e) => s + e.amount, 0));
  return { expenses, total, share: spending > 0 ? total / spending : 0 };
}
