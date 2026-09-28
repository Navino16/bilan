import { describe, it, expect } from "vitest";
import { categoryChanges, incomeByCategory, topMerchants, type MerchantRow } from "@/lib/insights";

const d = (day: number) => new Date(Date.UTC(2026, 2, day));

describe("categoryChanges", () => {
  it("sorts by absolute diff and drops unchanged categories", () => {
    const cur = [
      { amount: -700, categoryId: "rent" },
      { amount: -50, categoryId: "food" },
      { amount: -10, categoryId: "fun" },
      { amount: 900, categoryId: "pay" },
    ];
    const prev = [
      { amount: -500, categoryId: "rent" },
      { amount: -300, categoryId: "food" },
      { amount: -10, categoryId: "fun" },
    ];
    expect(categoryChanges(cur, prev)).toEqual([
      { categoryId: "food", current: 50, previous: 300, diff: -250 },
      { categoryId: "rent", current: 700, previous: 500, diff: 200 },
    ]);
  });

  it("includes categories only present in the previous period", () => {
    expect(categoryChanges([], [{ amount: -20, categoryId: null }])).toEqual([
      { categoryId: null, current: 0, previous: 20, diff: -20 },
    ]);
  });
});

describe("incomeByCategory", () => {
  it("keeps current income categories, highest first, with the previous amount", () => {
    const cur = [
      { amount: 21, categoryId: "refund" },
      { amount: 2650, categoryId: "pay" },
      { amount: -5, categoryId: "pay" },
    ];
    const prev = [
      { amount: 2600, categoryId: "pay" },
      { amount: 40, categoryId: "gift" },
    ];
    expect(incomeByCategory(cur, prev)).toEqual([
      { categoryId: "pay", current: 2650, previous: 2600 },
      { categoryId: "refund", current: 21, previous: 0 },
    ]);
  });
});

describe("topMerchants", () => {
  const row = (
    label: string,
    amount: number,
    day: number,
    categoryId: string | null = "food",
    type = "CARD",
  ): MerchantRow => ({ label, amount, date: d(day), categoryId, type });

  it("groups by normalized label with count, total and the latest label", () => {
    const out = topMerchants(
      [
        row("CB LIDL 03/03/26", -40, 3),
        row("CB Lidl 17/03/26", -60, 17),
        row("PRLV FONCIA LOYER", -700, 5, "rent", "DIRECT_DEBIT"),
      ],
      6,
    );
    expect(out).toEqual([
      { label: "FONCIA LOYER", total: 700, count: 1, categoryId: "rent" },
      { label: "Lidl", total: 100, count: 2, categoryId: "food" },
    ]);
  });

  it("excludes income, transfers and rows whose key is empty", () => {
    const out = topMerchants(
      [
        row("VIR LIVRET A", -200, 2, null, "TRANSFER"),
        row("REMB LIDL", 30, 4),
        row("CB 12/03", -9, 12),
      ],
      6,
    );
    expect(out).toEqual([]);
  });

  it("picks the most frequent category, ties broken by spend", () => {
    const out = topMerchants(
      [
        row("CB AMAZON", -10, 1, "books"),
        row("CB AMAZON", -12, 2, "books"),
        row("CB AMAZON", -90, 3, "tech"),
      ],
      6,
    );
    expect(out[0].categoryId).toBe("books");
    const tie = topMerchants(
      [row("CB AMAZON", -10, 1, "books"), row("CB AMAZON", -90, 3, "tech")],
      6,
    );
    expect(tie[0].categoryId).toBe("tech");
  });

  it("limits the result", () => {
    const rows = ["A", "B", "C"].map((m, i) => row(`CB SHOP${m}`, -(i + 1), i + 1));
    expect(topMerchants(rows, 2).map((m) => m.label)).toEqual(["SHOPC", "SHOPB"]);
  });
});
