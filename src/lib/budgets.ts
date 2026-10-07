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

export const _EPSILON = EPSILON; // exported for later tasks that need the tolerance

export type BudgetStatus = "OK" | "WARN" | "OVER";
export type LineStatus = {
  plannedAmount: number;
  spent: number;
  remaining: number;
  percent: number;
  status: BudgetStatus;
};

// Given a line's planned amount and its computed spend, derive the display
// figures. OVER when spent exceeds planned (epsilon); WARN from 80% up; else OK.
export function lineStatus(plannedAmount: number, spent: number): LineStatus {
  const remaining = round2(plannedAmount - spent);
  const percent =
    plannedAmount > 0 ? Math.round((spent / plannedAmount) * 100) : spent > EPSILON ? 100 : 0;
  const status: BudgetStatus =
    spent > plannedAmount + EPSILON ? "OVER" : percent >= 80 ? "WARN" : "OK";
  return { plannedAmount: round2(plannedAmount), spent: round2(spent), remaining, percent, status };
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
