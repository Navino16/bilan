import { describe, it, expect } from "vitest";
import {
  netSum,
  isBalanced,
  pickPrimary,
  pairKeyOf,
  findSuggestedPairs,
  collapseLinkedRows,
} from "@/lib/links";

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

  it("falls back to a non-ignored negative when the closest one is ignored", () => {
    // A +50 whose CLOSEST negative (day 1) forms an ignored pair, and a farther
    // non-ignored negative (day 5) still within the window → the farther pair
    // must still be suggested, not suppressed by the unrelated dismissal.
    const withAlt = [
      { id: "pos", amount: 50, date: new Date("2026-03-01T00:00:00.000Z") },
      { id: "near", amount: -50, date: new Date("2026-03-02T00:00:00.000Z") }, // closest, ignored
      { id: "far", amount: -50, date: new Date("2026-03-06T00:00:00.000Z") }, // valid alternative
    ];
    const pairs = findSuggestedPairs(withAlt, {
      windowDays: 30,
      minAmount: 0,
      ignored: new Set(["near|pos"]),
    });
    expect(pairs.map((p) => p.key)).toContain("far|pos");
  });
});

describe("collapseLinkedRows", () => {
  const base = (
    over: Partial<{
      id: string;
      amount: number;
      date: Date;
      categoryId: string | null;
      linkId: string | null;
    }>,
  ) => ({
    id: "x",
    amount: -10,
    date: new Date("2026-03-02T00:00:00.000Z"),
    categoryId: null as string | null,
    linkId: null as string | null,
    ...over,
  });

  it("keeps unlinked rows unchanged", () => {
    const rows = [base({ id: "a", amount: -10 }), base({ id: "b", amount: 5 })];
    const out = collapseLinkedRows(rows);
    expect(out).toHaveLength(2);
  });

  it("drops a balanced link entirely", () => {
    const rows = [
      base({ id: "a", amount: -50, linkId: "L1", categoryId: "groc" }),
      base({ id: "b", amount: 50, linkId: "L1" }),
    ];
    expect(collapseLinkedRows(rows)).toHaveLength(0);
  });

  it("collapses an unbalanced link to the net on the primary", () => {
    const rows = [
      base({
        id: "a",
        amount: -50,
        linkId: "L1",
        categoryId: "groc",
        date: new Date("2026-03-01T00:00:00.000Z"),
      }),
      base({
        id: "b",
        amount: 30,
        linkId: "L1",
        categoryId: "ref",
        date: new Date("2026-03-05T00:00:00.000Z"),
      }),
    ];
    const out = collapseLinkedRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a"); // primary = largest |amount|
    expect(out[0].amount).toBe(-20); // net
    expect(out[0].categoryId).toBe("groc"); // primary's category
  });
});
