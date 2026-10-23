import { describe, it, expect } from "vitest";
import {
  netSum,
  isBalanced,
  pickPrimary,
  pairKeyOf,
  findSuggestedPairs,
  collapseLinkedRows,
  labelWords,
  pairScore,
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

  it("matches amounts that differ only by floating-point noise", () => {
    const noisy = [
      { id: "a", amount: 0.1 + 0.2, date: new Date("2026-03-01T00:00:00.000Z") },
      { id: "b", amount: -0.3, date: new Date("2026-03-02T00:00:00.000Z") },
    ];
    const pairs = findSuggestedPairs(noisy, { windowDays: 30, minAmount: 0, ignored: new Set() });
    expect(pairs.map((p) => p.key)).toEqual(["a|b"]);
  });

  it("pairs each positive with the closest equal negative among many amounts", () => {
    const many = [
      ...Array.from({ length: 50 }, (_, i) => ({
        id: `n${String(i).padStart(2, "0")}`,
        amount: -(i + 1),
        date: new Date("2026-03-01T00:00:00.000Z"),
      })),
      { id: "n_close", amount: -25, date: new Date("2026-03-09T00:00:00.000Z") },
      { id: "p25", amount: 25, date: new Date("2026-03-10T00:00:00.000Z") },
      { id: "p99", amount: 99, date: new Date("2026-03-10T00:00:00.000Z") },
    ];
    const pairs = findSuggestedPairs(many, { windowDays: 30, minAmount: 0, ignored: new Set() });
    expect(pairs).toEqual([
      {
        key: "n_close|p25",
        positiveId: "p25",
        negativeId: "n_close",
        amount: 25,
        dayDelta: 1,
        score: 0,
      },
    ]);
  });

  it("keeps the first of equally close negatives (input order)", () => {
    const ties = [
      { id: "pos", amount: 10, date: new Date("2026-03-05T00:00:00.000Z") },
      { id: "z_first", amount: -10, date: new Date("2026-03-03T00:00:00.000Z") },
      { id: "a_second", amount: -10, date: new Date("2026-03-07T00:00:00.000Z") },
    ];
    const pairs = findSuggestedPairs(ties, { windowDays: 30, minAmount: 0, ignored: new Set() });
    expect(pairs.map((p) => p.negativeId)).toEqual(["z_first"]);
  });
});

describe("labelWords", () => {
  it("keeps significant words of a merchant key", () => {
    expect(labelWords("REMISE FIDELITE TENUE DE COMPTE")).toEqual(
      new Set(["REMISE", "FIDELITE", "TENUE", "COMPTE"]),
    );
    expect(labelWords("SEPA DE 12 AB")).toEqual(new Set());
  });
});

describe("link suggestion scoring (#337)", () => {
  const day = (d: number) => new Date(Date.UTC(2026, 2, d));
  const row = (id: string, amount: number, d: number, over: object = {}) => ({
    id,
    amount,
    date: day(d),
    accountId: "a",
    type: "CARD",
    merchantKeyHash: null,
    words: new Set<string>(),
    ...over,
  });
  const opts = { windowDays: 30, minAmount: 0, ignored: new Set<string>() };

  it("drops a same-account pair with unrelated labels", () => {
    const pairs = findSuggestedPairs(
      [
        row("in", 50, 2, { words: new Set(["MARTIN"]) }),
        row("out", -50, 3, { words: new Set(["LIDL"]) }),
      ],
      opts,
    );
    expect(pairs).toEqual([]);
  });

  it("keeps a same-account pair of the same merchant or with a shared word", () => {
    const refund = [
      row("buy", -30, 2, { merchantKeyHash: "h" }),
      row("back", 30, 9, { merchantKeyHash: "h" }),
    ];
    expect(findSuggestedPairs(refund, opts).map((p) => p.key)).toEqual(["back|buy"]);
    const rebate = [
      row("fee", -10, 30, { words: new Set(["TENUE", "COMPTE"]) }),
      row("rebate", 10, 30, { words: new Set(["REMISE", "TENUE", "COMPTE"]) }),
    ];
    expect(findSuggestedPairs(rebate, opts).map((p) => p.key)).toEqual(["fee|rebate"]);
  });

  it("prefers a transfer from another account to a same-account match a day closer", () => {
    const pairs = findSuggestedPairs(
      [
        row("in", 200, 10, { accountId: "savings", type: "TRANSFER", merchantKeyHash: "h" }),
        row("near", -200, 10, { accountId: "savings", type: "TRANSFER", merchantKeyHash: "h" }),
        row("other", -200, 9, { accountId: "checking", type: "TRANSFER" }),
      ],
      opts,
    );
    expect(pairs.map((p) => p.negativeId)).toEqual(["other"]);
  });

  it("lists pairs by score", () => {
    const pairs = findSuggestedPairs(
      [
        row("big", 500, 1, { merchantKeyHash: "x" }),
        row("bigneg", -500, 20, { merchantKeyHash: "x" }),
        row("small", 5, 1, { accountId: "b" }),
        row("smallneg", -5, 1),
      ],
      opts,
    );
    expect(pairs.map((p) => p.positiveId)).toEqual(["small", "big"]);
  });

  it("scores the other account, the same merchant and two transfers", () => {
    const a = row("a", 10, 1, { accountId: "x", type: "TRANSFER", merchantKeyHash: "h" });
    const b = row("b", -10, 1, { accountId: "y", type: "TRANSFER", merchantKeyHash: "h" });
    expect(pairScore(a, b, 0)).toBe(8);
    expect(pairScore(a, b, 6)).toBe(6);
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
