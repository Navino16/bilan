// Pure budget math — no DB. Amounts are euros as numbers; compare with epsilon.

import type { BudgetPeriodType } from "@/lib/validation/budget";

const EPSILON = 0.005;

export function round2(n: number): number {
  // `+ 0` normalizes a negative zero (e.g. from `-sum` when sum is 0) to +0 so
  // callers comparing with Object.is / toBe(0) don't trip on -0.
  return Math.round(n * 100) / 100 + 0;
}

// Planned total of a budget = sum of its lines' planned amounts.
export function budgetPlannedTotal(lines: { plannedAmount: number }[]): number {
  return round2(lines.reduce((s, l) => s + l.plannedAmount, 0));
}

export type BudgetStatus = "OK" | "WARN" | "REACHED" | "OVER";
export type LineStatus = {
  plannedAmount: number;
  spent: number;
  remaining: number;
  // null: spending against a zero planned amount, which has no meaningful ratio.
  percent: number | null;
  status: BudgetStatus;
};

// OVER and REACHED compare amounts within epsilon; the displayed percent is then
// clamped so it never contradicts the status (99.6 % reads 99 %, a tiny overspend 101 %).
export function lineStatus(plannedAmount: number, spent: number): LineStatus {
  const amounts = { plannedAmount: round2(plannedAmount), spent: round2(spent) };
  const remaining = round2(plannedAmount - spent);
  if (plannedAmount <= EPSILON) {
    const over = spent > plannedAmount + EPSILON;
    return { ...amounts, remaining, percent: over ? null : 0, status: over ? "OVER" : "OK" };
  }
  const ratio = (spent / plannedAmount) * 100;
  const status: BudgetStatus =
    spent > plannedAmount + EPSILON
      ? "OVER"
      : plannedAmount - spent <= EPSILON
        ? "REACHED"
        : ratio >= 80
          ? "WARN"
          : "OK";
  const percent =
    status === "OVER"
      ? Math.max(101, Math.round(ratio))
      : status === "REACHED"
        ? 100
        : Math.min(99, Math.floor(ratio));
  return { ...amounts, remaining, percent, status };
}

const DAY = 86_400_000;
const lastDayUtc = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

const PERIOD_MONTHS: Partial<Record<BudgetPeriodType, number>> = { MONTH: 1, QUARTER: 3, YEAR: 12 };

// Date.UTC maps years 0–99 to 1900–1999; setUTCFullYear doesn't.
function utcDay(y: number, m0: number, d: number): number {
  const date = new Date(0);
  date.setUTCFullYear(y, m0, d);
  return date.getTime();
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// Last day (YYYY-MM-DD) of a WEEK/MONTH/QUARTER/YEAR period starting on
// `startDay`; null for CUSTOM or an invalid date. A month-type period ends the
// day before the same day-of-month N months later, or at the end of that month
// when it is too short (31 Jan → 28 Feb).
export function periodEndFor(periodType: BudgetPeriodType, startDay: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDay);
  if (!m || periodType === "CUSTOM") return null;
  const [y, m0, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const start = utcDay(y, m0, d);
  if (new Date(start).getUTCDate() !== d) return null;
  let next: number;
  if (periodType === "WEEK") {
    next = start + 7 * DAY;
  } else {
    const target = m0 + PERIOD_MONTHS[periodType]!;
    next = d > lastDayUtc(y, target) ? utcDay(y, target + 1, 1) : utcDay(y, target, d);
  }
  return isoDay(next - DAY);
}

// The period immediately after [start, end]: a typed period starts the day
// after `end` and spans its type again; a CUSTOM one shifts by its length in
// whole days. Bounds stay UTC-inclusive.
export function nextPeriod(
  periodType: BudgetPeriodType,
  start: Date,
  end: Date,
): { start: Date; end: Date } {
  if (periodType !== "CUSTOM") {
    const startDay = isoDay(
      utcDay(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) + DAY,
    );
    const endDay = periodEndFor(periodType, startDay)!;
    return {
      start: new Date(`${startDay}T00:00:00.000Z`),
      end: new Date(`${endDay}T23:59:59.999Z`),
    };
  }
  const lengthDays = Math.round((end.getTime() - start.getTime() + 1) / DAY);
  return {
    start: new Date(start.getTime() + lengthDays * DAY),
    end: new Date(end.getTime() + lengthDays * DAY),
  };
}

export type SeriesMember = {
  id: string;
  parentBudgetId: string | null;
  periodStart: Date;
  started: boolean;
  ended: boolean;
};

// Groups budgets into recurring series (#156). The head is the period in
// progress, else the latest started one, else the next to come; `others` holds
// the rest of the series, newest first. Series are ordered by their head.
export function groupBudgetSeries<T extends SeriesMember>(items: T[]): { head: T; others: T[] }[] {
  const bySeries = new Map<string, T[]>();
  for (const b of items) {
    const key = b.parentBudgetId ?? b.id;
    bySeries.set(key, [...(bySeries.get(key) ?? []), b]);
  }
  const series = [...bySeries.values()].map((members) => {
    const desc = [...members].sort((a, b) => b.periodStart.getTime() - a.periodStart.getTime());
    const head =
      desc.find((b) => b.started && !b.ended) ??
      desc.find((b) => b.started) ??
      desc[desc.length - 1];
    return { head, others: desc.filter((b) => b !== head) };
  });
  return series.sort((a, b) => b.head.periodStart.getTime() - a.head.periodStart.getTime());
}
