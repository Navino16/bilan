import { describe, it, expect } from "vitest";
import { netSum, isBalanced, pickPrimary, pairKeyOf, findSuggestedPairs } from "@/lib/links";

describe("netSum", () => {
  it("sums signed amounts", () => {
    expect(netSum([-50, 50])).toBe(0);
    expect(netSum([-50, 30])).toBe(-20);
    expect(netSum([-50, 20, 10])).toBe(-20);
  });
});

describe("isBalanced", () => {
  it("is true when the net is within the epsilon of zero", () => {
    expect(isBalanced([-50, 50])).toBe(true);
    expect(isBalanced([-50.004, 50])).toBe(true); // < 0.005
    expect(isBalanced([-50, 30])).toBe(false);
  });
});

describe("pickPrimary", () => {
  it("picks the largest absolute amount", () => {
    const m = pickPrimary([
      { id: "b", amount: 30, date: new Date("2026-03-02T00:00:00.000Z") },
      { id: "a", amount: -50, date: new Date("2026-03-01T00:00:00.000Z") },
    ]);
    expect(m.id).toBe("a");
  });

  it("breaks ties by earliest date, then lowest id", () => {
    const m = pickPrimary([
      { id: "y", amount: 40, date: new Date("2026-03-05T00:00:00.000Z") },
      { id: "x", amount: -40, date: new Date("2026-03-02T00:00:00.000Z") },
      { id: "z", amount: 40, date: new Date("2026-03-02T00:00:00.000Z") },
    ]);
    expect(m.id).toBe("x"); // same |40|, earliest date 03-02, "x" < "z"
  });
});

describe("pairKeyOf", () => {
  it("is canonical regardless of order", () => {
    expect(pairKeyOf("b", "a")).toBe("a|b");
    expect(pairKeyOf("a", "b")).toBe("a|b");
  });
});

describe("findSuggestedPairs", () => {
  const rows = [
    { id: "exp", amount: -50, date: new Date("2026-03-02T00:00:00.000Z") },
    { id: "ref", amount: 50, date: new Date("2026-03-10T00:00:00.000Z") },
    { id: "small", amount: -3, date: new Date("2026-03-02T00:00:00.000Z") },
    { id: "smallref", amount: 3, date: new Date("2026-03-02T00:00:00.000Z") },
    { id: "far", amount: 50, date: new Date("2026-06-01T00:00:00.000Z") },
  ];

  it("pairs an expense with an opposite refund inside the window", () => {
    const pairs = findSuggestedPairs(rows, { windowDays: 30, minAmount: 0, ignored: new Set() });
    expect(pairs.map((p) => p.key)).toContain("exp|ref");
  });

  it("drops pairs outside the day window", () => {
    const pairs = findSuggestedPairs(rows, { windowDays: 30, minAmount: 0, ignored: new Set() });
    // 'far' (+50) is ~90 days from 'exp' (-50) → no pair
    expect(pairs.some((p) => p.key === "exp|far")).toBe(false);
  });

  it("drops pairs below the minimum amount", () => {
    const pairs = findSuggestedPairs(rows, { windowDays: 30, minAmount: 5, ignored: new Set() });
    expect(pairs.some((p) => p.key === "small|smallref")).toBe(false);
  });

  it("drops ignored pairs", () => {
    const pairs = findSuggestedPairs(rows, {
      windowDays: 30,
      minAmount: 0,
      ignored: new Set(["exp|ref"]),
    });
    expect(pairs.some((p) => p.key === "exp|ref")).toBe(false);
  });

  it("sorts by absolute amount desc then day-delta asc", () => {
    const pairs = findSuggestedPairs(rows, { windowDays: 60, minAmount: 0, ignored: new Set() });
    expect(pairs[0].key).toBe("exp|ref"); // |50| beats |3|
  });
});
