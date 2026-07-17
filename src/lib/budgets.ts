// Pure budget math — no DB. Amounts are euros as numbers; compare with epsilon.

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
