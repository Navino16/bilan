import { round2 } from "@/lib/budgets";
import { merchantParts, type MerchantPart, type MerchantRow } from "@/lib/insights";
import { merchantLabel } from "@/lib/merchant";

// Detection rules: spec §5.17.
export const RECURRING_MONTHS = 6;
export const RECURRING_MIN_COUNT = 3;
export const RECURRING_GAP_DAYS = { min: 20, max: 40 };
// A payment joins a series from −25 % to +50 % of its median: a price increase stays in it.
export const RECURRING_AMOUNT_RANGE = { below: 0.25, above: 0.5 };
export const INCREASE_THRESHOLD = { share: 0.05, min: 1 };
export const NEW_MONTHS = 2;
// A merchant paid this often per month it appears in is a shop, not a bill.
const MAX_PER_MONTH = 3;

const DAY = 86_400_000;

export type RecurringFlag = "new" | "increase" | "stopped";
export type RecurringPayment = {
  id: string;
  label: string;
  search: string;
  categoryId: string | null;
  usual: number;
  last: number;
  lastDate: Date;
  count: number;
  flags: RecurringFlag[];
};
export type RecurringPayments = {
  payments: RecurringPayment[];
  // What the payments still running cost a month now: the last amount of an increased one.
  monthly: number;
  // The part of `monthly` from new payments and price increases.
  extra: number;
};

type Occurrence = Pick<MerchantPart, "label" | "date" | "categoryId"> & { amount: number };

const days = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / DAY);
const monthOf = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Each payment, in date order, extends the series it fits best (gap and amount), else starts
// one: a merchant can hold several series, e.g. a loan and its insurance.
function seriesOf(occurrences: Occurrence[]): Occurrence[][] {
  const series: Occurrence[][] = [];
  for (const o of occurrences) {
    let best: Occurrence[] | undefined;
    let bestDiff = Infinity;
    for (const s of series) {
      const gap = days(s[s.length - 1].date, o.date);
      if (gap < RECURRING_GAP_DAYS.min || gap > RECURRING_GAP_DAYS.max) continue;
      const usual = median(s.map((x) => x.amount));
      const { below, above } = RECURRING_AMOUNT_RANGE;
      if (o.amount < usual * (1 - below) || o.amount > usual * (1 + above)) continue;
      const diff = Math.abs(o.amount - usual);
      if (diff < bestDiff) {
        best = s;
        bestDiff = diff;
      }
    }
    if (best) best.push(o);
    else series.push([o]);
  }
  return series.filter((s) => s.length >= RECURRING_MIN_COUNT);
}

const rank = (p: RecurringPayment) =>
  p.flags.includes("stopped") ? 2 : p.flags.length > 0 ? 0 : 1;

// Spending that comes back about every month at the same merchant, over the RECURRING_MONTHS
// calendar months ending at `asOf`. `dataStart` is the first recorded transaction: a series is
// only new when data was recorded before it.
export function recurringPayments(
  rows: MerchantRow[],
  asOf: Date,
  dataStart: Date | null,
  aliases: ReadonlyMap<string, string> = new Map(),
): RecurringPayments {
  const since = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - (RECURRING_MONTHS - 1), 1),
  );
  const groups = new Map<string, MerchantPart[]>();
  for (const p of merchantParts(rows)) {
    if (p.date < since || p.date > asOf) continue;
    const alias = aliases.get(p.key);
    const id = alias === undefined ? `k:${p.key}` : `a:${alias.toLocaleLowerCase()}`;
    const group = groups.get(id) ?? [];
    group.push(p);
    groups.set(id, group);
  }

  const payments: RecurringPayment[] = [];
  for (const [id, parts] of groups) {
    const months = new Set(parts.map((p) => monthOf(p.date)));
    if (parts.length >= MAX_PER_MONTH * months.size) continue;
    const sorted = parts
      .map((p) => ({ label: p.label, date: p.date, categoryId: p.categoryId, amount: p.total }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    for (const s of seriesOf(sorted)) {
      const first = s[0];
      const last = s[s.length - 1];
      const usual = round2(median(s.map((o) => o.amount)));
      const flags: RecurringFlag[] = [];
      if (days(last.date, asOf) > RECURRING_GAP_DAYS.max) {
        flags.push("stopped");
      } else {
        const fresh =
          monthOf(first.date) >= monthOf(asOf) - NEW_MONTHS &&
          sorted[0] === first &&
          dataStart !== null &&
          days(dataStart, first.date) >= RECURRING_GAP_DAYS.max;
        if (fresh) flags.push("new");
        const { share, min } = INCREASE_THRESHOLD;
        if (last.amount - usual > Math.max(usual * share, min)) flags.push("increase");
      }
      const search = merchantLabel(last.label);
      payments.push({
        id: `${id}:${first.date.toISOString()}`,
        label: aliases.get(parts[0].key) ?? search,
        search,
        categoryId: last.categoryId,
        usual,
        last: round2(last.amount),
        lastDate: last.date,
        count: s.length,
        flags,
      });
    }
  }
  payments.sort((a, b) => rank(a) - rank(b) || b.usual - a.usual || a.label.localeCompare(b.label));

  const running = payments.filter((p) => !p.flags.includes("stopped"));
  const now = (p: RecurringPayment) => (p.flags.includes("increase") ? p.last : p.usual);
  const extra = (p: RecurringPayment) =>
    p.flags.includes("new") ? now(p) : p.flags.includes("increase") ? p.last - p.usual : 0;
  return {
    payments,
    monthly: round2(running.reduce((s, p) => s + now(p), 0)),
    extra: round2(running.reduce((s, p) => s + extra(p), 0)),
  };
}
