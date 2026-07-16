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

const DAY_MS = 86_400_000;

// Canonical key for an unordered pair of transaction ids.
export function pairKeyOf(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export type SuggestedPair = {
  key: string;
  positiveId: string;
  negativeId: string;
  amount: number; // absolute value of the matched amount
  dayDelta: number;
};

// Pairs each positive amount with an equal-and-opposite negative within the day
// window, above the minimum, not already ignored. Greedy: each transaction is
// used in at most one pair (largest amounts first). Pure — no DB.
export function findSuggestedPairs(
  rows: LinkMemberRow[],
  opts: { windowDays: number; minAmount: number; ignored: Set<string> },
): SuggestedPair[] {
  const positives = rows.filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount);
  const negatives = rows.filter((r) => r.amount < 0);
  const used = new Set<string>();
  const pairs: SuggestedPair[] = [];

  for (const pos of positives) {
    if (used.has(pos.id)) continue;
    if (pos.amount < opts.minAmount) continue;
    let best: { neg: LinkMemberRow; dayDelta: number } | null = null;
    for (const neg of negatives) {
      if (used.has(neg.id)) continue;
      if (Math.abs(pos.amount + neg.amount) >= EPSILON) continue; // not opposite
      const dayDelta = Math.round(Math.abs(pos.date.getTime() - neg.date.getTime()) / DAY_MS);
      if (dayDelta > opts.windowDays) continue;
      if (!best || dayDelta < best.dayDelta) best = { neg, dayDelta };
    }
    if (!best) continue;
    const key = pairKeyOf(pos.id, best.neg.id);
    if (opts.ignored.has(key)) continue;
    used.add(pos.id);
    used.add(best.neg.id);
    pairs.push({
      key,
      positiveId: pos.id,
      negativeId: best.neg.id,
      amount: Math.round(pos.amount * 100) / 100,
      dayDelta: best.dayDelta,
    });
  }

  return pairs.sort((a, b) => b.amount - a.amount || a.dayDelta - b.dayDelta);
}

// A transaction row tagged with its link membership (null = not linked).
export type CollapsibleRow = {
  id: string;
  amount: number;
  date: Date;
  categoryId: string | null;
  linkId: string | null;
};

// Collapses links for aggregation: unlinked rows pass through; a balanced group
// is dropped; an unbalanced group becomes one synthetic row = its primary with
// amount replaced by the group's net sum. See plan §"Period boundary".
export function collapseLinkedRows<T extends CollapsibleRow>(rows: T[]): T[] {
  const groups = new Map<string, T[]>();
  const out: T[] = [];

  for (const r of rows) {
    if (r.linkId == null) {
      out.push(r);
      continue;
    }
    const g = groups.get(r.linkId);
    if (g) g.push(r);
    else groups.set(r.linkId, [r]);
  }

  for (const members of groups.values()) {
    const amounts = members.map((m) => m.amount);
    if (isBalanced(amounts)) continue; // balanced → excluded
    const primary = pickPrimary(members);
    out.push({ ...primary, amount: netSum(amounts) });
  }

  return out;
}
