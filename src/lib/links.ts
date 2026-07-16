// Pure link math — no DB. A "link" groups related transactions (a refund and
// its expense, an internal transfer's two legs, …). Amounts are signed
// (income > 0, expense < 0); compare with an epsilon, never `=== 0`.

const EPSILON = 0.005;

export type LinkMemberRow = {
  id: string;
  amount: number;
  date: Date;
};

export function netSum(amounts: number[]): number {
  return Math.round(amounts.reduce((s, a) => s + a, 0) * 100) / 100;
}

export function isBalanced(amounts: number[]): boolean {
  return Math.abs(netSum(amounts)) < EPSILON;
}

// The member that carries the link's net in collapsed aggregates: largest
// |amount|, ties → earliest date, then lowest id. Deterministic.
export function pickPrimary<T extends LinkMemberRow>(members: T[]): T {
  return [...members].sort((a, b) => {
    const byAbs = Math.abs(b.amount) - Math.abs(a.amount);
    if (byAbs !== 0) return byAbs;
    const byDate = a.date.getTime() - b.date.getTime();
    if (byDate !== 0) return byDate;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })[0];
}
