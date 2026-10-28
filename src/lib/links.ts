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
  score: number;
};

// Optional context of a candidate row: with it, pairs are filtered and ranked (POC).
export type PairCandidate = LinkMemberRow & {
  accountId?: string;
  type?: string;
  merchantKeyHash?: string | null;
  // Significant words of the label's merchant key (labelWords).
  words?: ReadonlySet<string>;
};

const GENERIC_WORDS = new Set([
  "DE",
  "DU",
  "DES",
  "LA",
  "LE",
  "LES",
  "ET",
  "AU",
  "AUX",
  "EN",
  "SEPA",
  "VIREMENT",
  "VIR",
  "PRLV",
  "CARTE",
  "PAIEMENT",
  "EMIS",
  "RECU",
  "MOTIF",
  "REF",
]);

export function labelWords(merchantKey: string): Set<string> {
  return new Set(
    merchantKey
      .split(/[^A-Z0-9]+/)
      .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !GENERIC_WORDS.has(w)),
  );
}

function sharesWord(a?: ReadonlySet<string>, b?: ReadonlySet<string>): boolean {
  if (!a || !b) return false;
  for (const w of a) if (b.has(w)) return true;
  return false;
}

// Within one account, an equal-and-opposite amount is a coincidence unless both rows are the
// same merchant (a refund, a reversal). Across accounts, closer dates, the same merchant and
// two transfers make the pair more likely. Null = not a candidate pair.
export function pairScore(pos: PairCandidate, neg: PairCandidate, dayDelta: number): number | null {
  if (pos.accountId === undefined || neg.accountId === undefined) return 0;
  const sameMerchant = !!pos.merchantKeyHash && pos.merchantKeyHash === neg.merchantKeyHash;
  const sameWords = sharesWord(pos.words, neg.words);
  if (pos.accountId === neg.accountId && !sameMerchant && !sameWords) return null;
  let score = 0;
  if (pos.accountId !== neg.accountId) score += 4;
  if (sameMerchant) score += 3;
  else if (sameWords) score += 2;
  if (pos.type === "TRANSFER" && neg.type === "TRANSFER") score += 1;
  return score - dayDelta / 3;
}

// Pairs each positive amount with an equal-and-opposite negative within the day
// window, above the minimum, not already ignored. Greedy: each transaction is
// used in at most one pair (largest amounts first). Pure — no DB.
export function findSuggestedPairs(
  rows: PairCandidate[],
  opts: { windowDays: number; minAmount: number; ignored: Set<string> },
): SuggestedPair[] {
  const positives = rows.filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount);
  // Negatives bucketed by cents (input order kept) so each positive only scans its matches.
  const negativesByCents = new Map<number, PairCandidate[]>();
  for (const r of rows) {
    if (r.amount >= 0) continue;
    const cents = Math.round(-r.amount * 100);
    const bucket = negativesByCents.get(cents);
    if (bucket) bucket.push(r);
    else negativesByCents.set(cents, [r]);
  }
  const used = new Set<string>();
  const pairs: SuggestedPair[] = [];

  for (const pos of positives) {
    if (used.has(pos.id)) continue;
    if (pos.amount < opts.minAmount) continue;
    let best: { neg: PairCandidate; dayDelta: number; score: number } | null = null;
    for (const neg of negativesByCents.get(Math.round(pos.amount * 100)) ?? []) {
      if (used.has(neg.id)) continue;
      if (Math.abs(pos.amount + neg.amount) >= EPSILON) continue; // not opposite
      if (opts.ignored.has(pairKeyOf(pos.id, neg.id))) continue; // dismissed → skip, try next
      const dayDelta = Math.round(Math.abs(pos.date.getTime() - neg.date.getTime()) / DAY_MS);
      if (dayDelta > opts.windowDays) continue;
      const score = pairScore(pos, neg, dayDelta);
      if (score === null) continue;
      if (!best || score > best.score || (score === best.score && dayDelta < best.dayDelta)) {
        best = { neg, dayDelta, score };
      }
    }
    if (!best) continue;
    const key = pairKeyOf(pos.id, best.neg.id);
    used.add(pos.id);
    used.add(best.neg.id);
    pairs.push({
      key,
      positiveId: pos.id,
      negativeId: best.neg.id,
      amount: Math.round(pos.amount * 100) / 100,
      dayDelta: best.dayDelta,
      score: best.score,
    });
  }

  return pairs.sort((a, b) => b.score - a.score || b.amount - a.amount || a.dayDelta - b.dayDelta);
}

export const AUTO_LINK_WINDOW_DAYS = 4;

export type AutoLinkCandidate = PairCandidate & { accountId: string };

type Edge = { pos: AutoLinkCandidate; neg: AutoLinkCandidate; score: number };

// The edge that strictly outscores every other edge of the same row; null on a tie.
function strictBest(edges: Edge[]): Edge | null {
  let best: Edge | null = null;
  let tied = false;
  for (const e of edges) {
    if (!best || e.score > best.score) {
      best = e;
      tied = false;
    } else if (e.score === best.score) tied = true;
  }
  return tied ? null : best;
}

// Transfer legs to link without asking: cross-account, opposite to the cent, within the
// window, and each leg's strictly best candidate is the other (spec A). Ties stay suggestions.
export function findAutoLinkPairs(
  rows: AutoLinkCandidate[],
  opts: { windowDays: number; ignored: Set<string> },
): { positiveId: string; negativeId: string }[] {
  const negativesByCents = new Map<number, AutoLinkCandidate[]>();
  for (const r of rows) {
    if (r.amount >= 0) continue;
    const cents = Math.round(-r.amount * 100);
    const bucket = negativesByCents.get(cents);
    if (bucket) bucket.push(r);
    else negativesByCents.set(cents, [r]);
  }
  const edgesOf = new Map<string, Edge[]>();
  const add = (id: string, e: Edge) => {
    const list = edgesOf.get(id);
    if (list) list.push(e);
    else edgesOf.set(id, [e]);
  };
  for (const pos of rows) {
    if (pos.amount <= 0) continue;
    for (const neg of negativesByCents.get(Math.round(pos.amount * 100)) ?? []) {
      if (pos.accountId === neg.accountId) continue;
      if (opts.ignored.has(pairKeyOf(pos.id, neg.id))) continue;
      const dayDelta = Math.round(Math.abs(pos.date.getTime() - neg.date.getTime()) / DAY_MS);
      if (dayDelta > opts.windowDays) continue;
      const score = pairScore(pos, neg, dayDelta);
      if (score === null) continue;
      const edge = { pos, neg, score };
      add(pos.id, edge);
      add(neg.id, edge);
    }
  }
  const pairs: { positiveId: string; negativeId: string }[] = [];
  for (const pos of rows) {
    const edge = pos.amount > 0 ? strictBest(edgesOf.get(pos.id) ?? []) : null;
    if (edge && strictBest(edgesOf.get(edge.neg.id)!) === edge) {
      pairs.push({ positiveId: pos.id, negativeId: edge.neg.id });
    }
  }
  return pairs;
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
