import { describe, it, expect } from "vitest";
import { budgetPlannedTotal } from "@/lib/budgets";

describe("budgetPlannedTotal", () => {
  it("sums line planned amounts, rounded to cents", () => {
    expect(budgetPlannedTotal([{ plannedAmount: 100 }, { plannedAmount: 49.9 }])).toBe(149.9);
    expect(budgetPlannedTotal([])).toBe(0);
  });
});
