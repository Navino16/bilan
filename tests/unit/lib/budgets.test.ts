import { describe, it, expect } from "vitest";
import { budgetPlannedTotal, lineStatus } from "@/lib/budgets";

describe("budgetPlannedTotal", () => {
  it("sums line planned amounts, rounded to cents", () => {
    expect(budgetPlannedTotal([{ plannedAmount: 100 }, { plannedAmount: 49.9 }])).toBe(149.9);
    expect(budgetPlannedTotal([])).toBe(0);
  });
});

describe("lineStatus", () => {
  it("is OK below 80%", () => {
    expect(lineStatus(100, 50)).toEqual({
      plannedAmount: 100,
      spent: 50,
      remaining: 50,
      percent: 50,
      status: "OK",
    });
  });
  it("is WARN at 80%..100%", () => {
    expect(lineStatus(100, 80).status).toBe("WARN");
    expect(lineStatus(100, 100).status).toBe("WARN");
  });
  it("is OVER above planned", () => {
    const s = lineStatus(100, 120);
    expect(s.status).toBe("OVER");
    expect(s.remaining).toBe(-20);
    expect(s.percent).toBe(120);
  });
  it("handles a zero planned amount", () => {
    expect(lineStatus(0, 0)).toMatchObject({ percent: 0, status: "OK" });
    expect(lineStatus(0, 10)).toMatchObject({ percent: 100, status: "OVER" });
  });
});
