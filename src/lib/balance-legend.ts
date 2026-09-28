export const LEGEND_MAX = 5;

type LegendAccount = { id: string; name: string; color: string | null; balance: number };

// Global-balance bar + legend (issue #112 §4): the largest positive balances, the rest
// folded into one « Autres » entry. Grouping only kicks in beyond LEGEND_MAX + 1 accounts.
export function balanceLegend<T extends LegendAccount>(accounts: T[]) {
  const sorted = [...accounts].sort((a, b) => b.balance - a.balance);
  const positiveTotal = accounts.reduce((sum, a) => sum + Math.max(a.balance, 0), 0);

  if (accounts.length <= LEGEND_MAX + 1) return { items: sorted, others: null, positiveTotal };

  const items = sorted.filter((a) => a.balance > 0).slice(0, LEGEND_MAX);
  const rest = sorted.slice(items.length);
  return {
    items,
    others: {
      count: rest.length,
      positive: rest.reduce((sum, a) => sum + Math.max(a.balance, 0), 0),
    },
    positiveTotal,
  };
}
