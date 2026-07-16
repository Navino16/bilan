// Pure budget math — no DB. Amounts are euros as numbers; compare with epsilon.

const EPSILON = 0.005;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Planned total of a budget = sum of its lines' planned amounts.
export function budgetPlannedTotal(lines: { plannedAmount: number }[]): number {
  return round2(lines.reduce((s, l) => s + l.plannedAmount, 0));
}

export const _EPSILON = EPSILON; // exported for later tasks that need the tolerance
