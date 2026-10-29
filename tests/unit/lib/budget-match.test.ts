import { describe, it, expect } from "vitest";
import { bucketRow, lineFlow, type MatchLine, type MatchRow } from "@/lib/budget-match";
import { budgetLanding } from "@/lib/budgets";

const expense = (categoryId: string, subtree: string[] = []): MatchLine => ({
  kind: "EXPENSE",
  categoryId,
  categoryIds: new Set([categoryId, ...subtree]),
  direction: null,
  counterpartAccountId: null,
});
const income = (categoryId: string): MatchLine => ({ ...expense(categoryId), kind: "INCOME" });
const transfer = (direction: "OUT" | "IN", counterpartAccountId: string): MatchLine => ({
  kind: "TRANSFER",
  categoryId: null,
  categoryIds: null,
  direction,
  counterpartAccountId,
});
const row = (amount: number, over: Partial<MatchRow> = {}): MatchRow => ({
  amount,
  categoryId: null,
  partnerAccountIds: [],
  pendingAccountIds: [],
  ...over,
});

describe("lineFlow", () => {
  it("reads income and incoming transfers as inflows", () => {
    expect(lineFlow({ kind: "INCOME", direction: null })).toBe("in");
    expect(lineFlow({ kind: "TRANSFER", direction: "IN" })).toBe("in");
    expect(lineFlow({ kind: "TRANSFER", direction: "OUT" })).toBe("out");
    expect(lineFlow({ kind: "EXPENSE", direction: null })).toBe("out");
  });
});

describe("bucketRow", () => {
  it("sends a linked outgoing leg to the transfer line of its counterpart first", () => {
    const r = row(-300, { categoryId: "livrets", partnerAccountIds: ["livret"] });
    expect(bucketRow(r, [expense("livrets"), transfer("OUT", "livret")])).toBe(1);
  });

  it("never matches an incoming leg with an outgoing line", () => {
    expect(
      bucketRow(row(300, { partnerAccountIds: ["livret"] }), [transfer("OUT", "livret")]),
    ).toBe("unplanned");
  });

  it("matches an unlinked leg with a pending counterpart to the transfer line", () => {
    const lines = [expense("livrets"), transfer("OUT", "livret")];
    expect(
      bucketRow(row(-300, { categoryId: "livrets", pendingAccountIds: ["livret"] }), lines),
    ).toBe(1);
    expect(
      bucketRow(row(-300, { categoryId: "livrets", pendingAccountIds: ["joint"] }), lines),
    ).toBe(0);
  });

  it("sends an expense to the most specific expense line, the first one on a tie", () => {
    const lines = [expense("loisirs", ["musique"]), expense("musique"), expense("musique")];
    expect(bucketRow(row(-20, { categoryId: "musique" }), lines)).toBe(1);
    expect(bucketRow(row(-20, { categoryId: "loisirs" }), lines)).toBe(0);
  });

  it("sends income to its income line and a refund to its expense line", () => {
    const lines = [expense("courses"), income("salary")];
    expect(bucketRow(row(2000, { categoryId: "salary" }), lines)).toBe(1);
    expect(bucketRow(row(15, { categoryId: "courses" }), lines)).toBe(0);
  });

  it("never takes an incoming transfer leg as a refund", () => {
    const lines = [expense("livrets")];
    expect(
      bucketRow(row(300, { categoryId: "livrets", partnerAccountIds: ["livret"] }), lines),
    ).toBe("unplanned");
    expect(
      bucketRow(row(300, { categoryId: "livrets", pendingAccountIds: ["livret"] }), lines),
    ).toBe("unplanned");
  });

  it("leaves the rest out of budget or as unplanned income", () => {
    const lines = [income("salary")];
    expect(bucketRow(row(-12), lines)).toBe("out");
    expect(bucketRow(row(40), lines)).toBe("unplanned");
    expect(bucketRow(row(-50, { categoryId: "salary" }), lines)).toBe("out");
  });
});

describe("budgetLanding", () => {
  it("adds income still expected and subtracts spending still to come", () => {
    expect(
      budgetLanding({
        balance: 2668,
        lines: [
          { flow: "in", plannedAmount: 2000, doneOnAccount: 2000, doneLater: 0 },
          { flow: "out", plannedAmount: 500, doneOnAccount: 300, doneLater: 0 },
          { flow: "out", plannedAmount: 30, doneOnAccount: 20, doneLater: 0 },
        ],
        margin: 100,
        outOnAccount: 12,
        outLater: 0,
      }),
    ).toEqual({ balance: 2668, incomeToCome: 0, spendingToCome: 298, endBalance: 2370 });
  });

  it("ignores overruns and a missing margin, and expects income not arrived yet", () => {
    expect(
      budgetLanding({
        balance: 100.1,
        lines: [
          { flow: "out", plannedAmount: 30, doneOnAccount: 50, doneLater: 0 },
          { flow: "in", plannedAmount: 2000, doneOnAccount: 0, doneLater: 0 },
        ],
        margin: null,
        outOnAccount: 12,
        outLater: 0,
      }),
    ).toEqual({ balance: 100.1, incomeToCome: 2000, spendingToCome: 0, endBalance: 2100.1 });
  });

  it("counts rows already dated later in the period when they exceed what is left", () => {
    expect(
      budgetLanding({
        balance: 1000,
        lines: [
          { flow: "out", plannedAmount: 30, doneOnAccount: 20, doneLater: 40 },
          { flow: "in", plannedAmount: 100, doneOnAccount: 0, doneLater: 150 },
        ],
        margin: 100,
        outOnAccount: 12,
        outLater: 500,
      }),
    ).toEqual({ balance: 1000, incomeToCome: 150, spendingToCome: 540, endBalance: 610 });
    expect(
      budgetLanding({
        balance: 1000,
        lines: [],
        margin: null,
        outOnAccount: 0,
        outLater: 60,
      }).spendingToCome,
    ).toBe(60);
  });
});
