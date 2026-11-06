import { round2 } from "@/lib/budgets";
import { merchantParts, type MerchantPart, type MerchantRow } from "@/lib/insights";
import { merchantLabel } from "@/lib/merchant";

// Detection rules: spec §5.17.
export const RECURRING_MONTHS = 6;
export const RECURRING_MIN_COUNT = 3;
// Days between two payments of a series: a month, or two when one month was skipped, ± 5 days.
export const RECURRING_GAP = { months: [1, 2], days: 5 };
// A payment joins a series between 2/3 and 1.5 times its median.
export const RECURRING_AMOUNT_FACTOR = 1.5;
// A shop, not a bill: its series hold under 80 % of its payments, or it is paid 3 times or more
// per month it appears in.
export const RECURRING_COVERAGE = 0.8;
export const MAX_PER_MONTH = 3;
export const STOPPED_AFTER_DAYS = 40;
export const INCREASE_THRESHOLD = { share: 0.05, min: 1 };
export const NEW_MONTHS = 2;

const DAY = 86_400_000;
const MONTH_DAYS = 30.44;

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

type Occurrence = Pick<MerchantPart, "id" | "label" | "date" | "categoryId"> & { amount: number };

const days = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / DAY);
const monthOf = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();
const monthlyGap = (gap: number) =>
  RECURRING_GAP.months.some((m) => Math.abs(gap - m * MONTH_DAYS) <= RECURRING_GAP.days);

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
      if (!monthlyGap(days(s[s.length - 1].date, o.date))) continue;
      const diff = Math.abs(Math.log(o.amount / median(s.map((x) => x.amount))));
      if (diff > Math.log(RECURRING_AMOUNT_FACTOR)) continue;
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

type MerchantSeries = {
  id: string;
  parts: MerchantPart[];
  sorted: Occurrence[];
  series: Occurrence[][];
};

// The series of each merchant over the RECURRING_MONTHS calendar months ending at `asOf`, shops
// left out.
function merchantSeries(
  rows: MerchantRow[],
  asOf: Date,
  aliases: ReadonlyMap<string, string>,
): MerchantSeries[] {
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

  const out: MerchantSeries[] = [];
  for (const [id, parts] of groups) {
    const sorted = parts
      .map((p) => ({
        id: p.id,
        label: p.label,
        date: p.date,
        categoryId: p.categoryId,
        amount: p.total,
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    const months = new Set(sorted.map((o) => monthOf(o.date))).size;
    if (sorted.length >= MAX_PER_MONTH * months) continue;
    const series = seriesOf(sorted);
    if (series.reduce((n, s) => n + s.length, 0) < RECURRING_COVERAGE * sorted.length) continue;
    out.push({ id, parts, sorted, series });
  }
  return out;
}

// The rows (by id) that belong to a recurring series.
export function recurringIds(
  rows: MerchantRow[],
  asOf: Date,
  aliases: ReadonlyMap<string, string> = new Map(),
): Set<string> {
  return new Set(
    merchantSeries(rows, asOf, aliases).flatMap((m) =>
      m.series.flatMap((s) => s.flatMap((o) => (o.id ? [o.id] : []))),
    ),
  );
}

// Spending that comes back about every month at the same merchant, over the RECURRING_MONTHS
// calendar months ending at `asOf`. `dataStart` is the first recorded transaction: a series is
// only new when data was recorded before it.
export function recurringPayments(
  rows: MerchantRow[],
  asOf: Date,
  dataStart: Date | null,
  aliases: ReadonlyMap<string, string> = new Map(),
): RecurringPayments {
  const payments: RecurringPayment[] = [];
  for (const { id, parts, sorted, series } of merchantSeries(rows, asOf, aliases)) {
    for (const s of series) {
      const first = s[0];
      const last = s[s.length - 1];
      const usual = round2(median(s.map((o) => o.amount)));
      const flags: RecurringFlag[] = [];
      if (days(last.date, asOf) > STOPPED_AFTER_DAYS) {
        flags.push("stopped");
      } else {
        const fresh =
          monthOf(first.date) >= monthOf(asOf) - NEW_MONTHS &&
          sorted[0] === first &&
          dataStart !== null &&
          days(dataStart, first.date) >= STOPPED_AFTER_DAYS;
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
