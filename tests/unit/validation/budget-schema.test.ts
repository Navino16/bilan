import { describe, it, expect } from "vitest";
import { budgetInputSchema, type BudgetInput } from "@/lib/schemas/budget";

const base: BudgetInput = {
  name: "Mars",
  periodType: "MONTH",
  periodStart: "2026-03-01",
  periodEnd: "2026-03-31",
  lines: [{ categoryId: "cat", plannedAmount: 10 }],
};
const attached = { ...base, accountId: "courant" };

function issuePaths(input: BudgetInput): string[] {
  const r = budgetInputSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
}

describe("budget input: account budgets", () => {
  it("defaults lines to the expense kind", () => {
    const r = budgetInputSchema.parse(attached);
    expect(r.accountId).toBe("courant");
    expect(r.lines[0].kind).toBe("EXPENSE");
  });

  it("refuses income or transfer lines and a margin on an unattached budget", () => {
    expect(
      budgetInputSchema.safeParse({
        ...base,
        lines: [{ kind: "INCOME", categoryId: "cat", plannedAmount: 10 }],
      }).success,
    ).toBe(false);
    expect(budgetInputSchema.safeParse({ ...base, outOfBudgetPlanned: "10" }).success).toBe(false);
  });

  it("requires a category on attached expense and income lines", () => {
    expect(issuePaths({ ...attached, lines: [{ kind: "EXPENSE", plannedAmount: 10 }] })).toEqual([
      "lines.0.categoryId",
    ]);
    expect(
      budgetInputSchema.safeParse({
        ...attached,
        lines: [{ kind: "INCOME", categoryId: "salary", plannedAmount: 2000 }],
      }).success,
    ).toBe(true);
  });

  it("requires a direction and another counterpart account on transfer lines, and no category", () => {
    const transfer = { kind: "TRANSFER" as const, plannedAmount: 300 };
    expect(
      budgetInputSchema.safeParse({
        ...attached,
        lines: [{ ...transfer, counterpartAccountId: "livret" }],
      }).success,
    ).toBe(false);
    expect(issuePaths({ ...attached, lines: [{ ...transfer, direction: "OUT" }] })).toEqual([
      "lines.0.counterpartAccountId",
    ]);
    expect(
      budgetInputSchema.safeParse({
        ...attached,
        lines: [{ ...transfer, direction: "OUT", counterpartAccountId: "courant" }],
      }).success,
    ).toBe(false);
    expect(
      budgetInputSchema.safeParse({
        ...attached,
        lines: [{ ...transfer, direction: "OUT", counterpartAccountId: "livret", categoryId: "c" }],
      }).success,
    ).toBe(false);
    expect(
      budgetInputSchema.safeParse({
        ...attached,
        lines: [{ ...transfer, direction: "IN", counterpartAccountId: "livret" }],
      }).success,
    ).toBe(true);
  });

  it("reads the out-of-budget margin as an optional non-negative amount", () => {
    expect(
      budgetInputSchema.parse({ ...attached, outOfBudgetPlanned: "" }).outOfBudgetPlanned,
    ).toBe(undefined);
    expect(
      budgetInputSchema.parse({ ...attached, outOfBudgetPlanned: "12,5" }).outOfBudgetPlanned,
    ).toBe(12.5);
    expect(budgetInputSchema.safeParse({ ...attached, outOfBudgetPlanned: "-1" }).success).toBe(
      false,
    );
  });
});
