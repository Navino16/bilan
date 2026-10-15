export const LEGEND_MAX = 5;

type LegendAccount = { id: string; name: string; color: string | null; balance: number };

const positive = (n: number) => Math.max(n, 0);
const negative = (n: number) => Math.max(-n, 0);

// Global-balance bar + legend (issue #112 §4): the largest positive balances, the rest
// folded into one « Autres » entry. Grouping only kicks in beyond LEGEND_MAX + 1 accounts.
export function balanceLegend<T extends LegendAccount>(accounts: T[]) {
  const sorted = [...accounts].sort((a, b) => b.balance - a.balance);
  const positiveTotal = accounts.reduce((sum, a) => sum + positive(a.balance), 0);
  const negativeTotal = accounts.reduce((sum, a) => sum + negative(a.balance), 0);

  if (accounts.length <= LEGEND_MAX + 1) {
    return { items: sorted, others: null, positiveTotal, negativeTotal };
  }

  const items = sorted.filter((a) => a.balance > 0).slice(0, LEGEND_MAX);
  const rest = sorted.slice(items.length);
  return {
    items,
    others: {
      count: rest.length,
      positive: rest.reduce((sum, a) => sum + positive(a.balance), 0),
      negative: rest.reduce((sum, a) => sum + negative(a.balance), 0),
    },
    positiveTotal,
    negativeTotal,
  };
}

export type BalanceSegment = { id: string; share: number; negative: boolean };

// Bar segments as shares of assets + debts: positive balances first, then the negative ones,
// so a negative total shows as a mostly-debt bar (#244).
export function balanceSegments(legend: ReturnType<typeof balanceLegend>): BalanceSegment[] {
  const gross = legend.positiveTotal + legend.negativeTotal;
  if (gross === 0) return [];
  const { items, others } = legend;
  const parts = [
    ...items.filter((a) => a.balance > 0).map((a) => ({ id: a.id, value: a.balance, neg: false })),
    ...(others?.positive ? [{ id: "others", value: others.positive, neg: false }] : []),
    ...items.filter((a) => a.balance < 0).map((a) => ({ id: a.id, value: -a.balance, neg: true })),
    ...(others?.negative ? [{ id: "others", value: others.negative, neg: true }] : []),
  ];
  return parts.map((p) => ({ id: p.id, share: p.value / gross, negative: p.neg }));
}
