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

// The period immediately after [start, end] for a budget of the given type.
// MONTH/QUARTER/YEAR step by calendar unit **only when the bounds are actually
// calendar-aligned** (1st 00:00:00.000 → last-day 23:59:59.999); otherwise —
// like WEEK/CUSTOM — they shift by the window length so the span is preserved
// and consecutive instances neither gap nor overlap. Bounds stay UTC-inclusive.
export function nextPeriod(
  periodType: BudgetPeriodType,
  start: Date,
  end: Date,
): { start: Date; end: Date } {
  if (periodType === "MONTH" || periodType === "QUARTER" || periodType === "YEAR") {
    const months = periodType === "MONTH" ? 1 : periodType === "QUARTER" ? 3 : 12;
    const y = start.getUTCFullYear();
    const m0 = start.getUTCMonth();
    // Is [start, end] exactly the calendar block of `months` starting this month?
    const lastZero = y * 12 + m0 + months - 1;
    const ly = Math.floor(lastZero / 12);
    const lm0 = ((lastZero % 12) + 12) % 12;
    const alignedStart = Date.UTC(y, m0, 1, 0, 0, 0, 0);
    const alignedEnd = Date.UTC(ly, lm0, lastDayUtc(ly, lm0), 23, 59, 59, 999);
    if (start.getTime() === alignedStart && end.getTime() === alignedEnd) {
      const zeroFrom = y * 12 + m0 + months;
      const zeroTo = zeroFrom + months - 1;
      const sy = Math.floor(zeroFrom / 12);
      const sm0 = ((zeroFrom % 12) + 12) % 12;
      const ey = Math.floor(zeroTo / 12);
      const em0 = ((zeroTo % 12) + 12) % 12;
      return {
        start: new Date(Date.UTC(sy, sm0, 1, 0, 0, 0, 0)),
        end: new Date(Date.UTC(ey, em0, lastDayUtc(ey, em0), 23, 59, 59, 999)),
      };
    }
    // Non-calendar bounds → fall through to the span-preserving shift.
  }
  // WEEK / CUSTOM (and non-aligned M/Q/Y) → shift both bounds by the window
  // length in whole days.
  const lengthDays = Math.round((end.getTime() - start.getTime() + 1) / DAY);
  const nextStart = new Date(start.getTime() + lengthDays * DAY);
  const nextEnd = new Date(end.getTime() + lengthDays * DAY);
  return { start: nextStart, end: nextEnd };
}
