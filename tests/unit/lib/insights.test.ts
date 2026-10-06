import { describe, it, expect } from "vitest";
import {
  averageMonthRows,
  categoryChanges,
  historyRows,
  incomeByCategory,
  monthlyCategoryTotals,
  topMerchants,
  type CategoryHistory,
  type MerchantRow,
} from "@/lib/insights";

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
      {
        label: "FONCIA LOYER",
        search: "FONCIA LOYER",
        keys: ["FONCIA LOYER"],
        alias: null,
        total: 700,
        count: 1,
        categoryId: "rent",
      },
      {
        label: "Lidl",
        search: "Lidl",
        keys: ["LIDL"],
        alias: null,
        total: 100,
        count: 2,
        categoryId: "food",
      },
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

  it("shows an alias as the display name and keeps the bank label for the search", () => {
    const out = topMerchants(
      [row("PRLV FONCIA LOYER", -700, 5, "rent")],
      6,
      new Map([["FONCIA LOYER", "Loyer"]]),
    );
    expect(out[0]).toMatchObject({
      label: "Loyer",
      search: "FONCIA LOYER",
      keys: ["FONCIA LOYER"],
      alias: "Loyer",
    });
  });

  it("merges merchants sharing an alias, leaving the others apart", () => {
    const out = topMerchants(
      [row("CB LIDL", -40, 3), row("CB CARREFOUR MARKET", -60, 9), row("CB MONOPRIX", -10, 4)],
      6,
      new Map([
        ["LIDL", "Supermarché"],
        ["CARREFOUR MARKET", "Supermarché"],
      ]),
    );
    expect(out).toEqual([
      {
        label: "Supermarché",
        search: "CARREFOUR MARKET",
        keys: ["CARREFOUR MARKET", "LIDL"],
        alias: "Supermarché",
        total: 100,
        count: 2,
        categoryId: "food",
      },
      expect.objectContaining({ label: "MONOPRIX", alias: null, keys: ["MONOPRIX"] }),
    ]);
  });

  it("groups aliases whose names differ only by case, apart from an unaliased namesake", () => {
    const out = topMerchants(
      [row("CB LIDL", -40, 3), row("CB LIDL SAS", -10, 9), row("CB ALDI", -5, 4)],
      6,
      new Map([
        ["LIDL", "Aldi"],
        ["LIDL SAS", "aldi"],
      ]),
    );
    expect(out.map((m) => [m.label, m.total, m.keys])).toEqual([
      ["Aldi", 50, ["LIDL", "LIDL SAS"]],
      ["ALDI", 5, ["ALDI"]],
    ]);
  });
});

describe("monthlyCategoryTotals", () => {
  const months = [
    { year: 2025, month: 12 },
    { year: 2026, month: 1 },
    { year: 2026, month: 2 },
  ];
  const at = (y: number, m: number, day = 10) => new Date(Date.UTC(y, m - 1, day));

  it("sums spending per category and month, zero-filling months without any", () => {
    const rows = [
      { amount: -40, categoryId: "food", date: at(2025, 12) },
      { amount: -10.5, categoryId: "food", date: at(2025, 12, 28) },
      { amount: -20, categoryId: "food", date: at(2026, 2) },
      { amount: -700, categoryId: "rent", date: at(2026, 1) },
      { amount: -5, categoryId: null, date: at(2026, 2) },
      { amount: 2000, categoryId: "pay", date: at(2026, 1) },
      { amount: -99, categoryId: "food", date: at(2026, 3) },
    ];
    expect(monthlyCategoryTotals(rows, months)).toEqual([
      { categoryId: null, values: [0, 0, 5] },
      { categoryId: "food", values: [50.5, 0, 20] },
      { categoryId: "rent", values: [0, 700, 0] },
    ]);
  });
});

describe("historyRows", () => {
  const months = Array.from({ length: 12 }, (_, i) => ({ year: 2026, month: i + 1 }));
  const history = (inProgress: boolean): CategoryHistory => ({
    months,
    inProgress,
    series: [
      { categoryId: "rent", values: Array(12).fill(800) },
      { categoryId: "food", values: [900, 900, 900, 900, 900, 900, 300, 300, 300, 300, 300, 30] },
      { categoryId: "trip", values: [0, 0, 0, 0, 0, 600, 0, 0, 0, 0, 0, 0] },
      { categoryId: "fun", values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40, 0] },
    ],
  });

  it("keeps the last months, ranked by total, dropping categories with no spending", () => {
    const { months: shown, rows } = historyRows(history(false), 6, 10);
    expect(shown).toEqual(months.slice(6));
    expect(rows.map((r) => r.categoryId)).toEqual(["rent", "food", "fun"]);
    expect(rows[1]).toEqual({
      categoryId: "food",
      values: [300, 300, 300, 300, 300, 30],
      total: 1530,
      average: 255,
    });
  });

  it("leaves the month in progress out of the average", () => {
    const { rows } = historyRows(history(true), 6, 10);
    expect(rows.find((r) => r.categoryId === "food")?.average).toBe(300);
  });

  it("limits the number of rows", () => {
    const { rows } = historyRows(history(false), 12, 2);
    expect(rows.map((r) => r.categoryId)).toEqual(["rent", "food"]);
  });
});

describe("averageMonthRows", () => {
  const at = (m: number, day: number) => new Date(Date.UTC(2026, m - 1, day));
  const rows = [
    { amount: -40, categoryId: "food", date: at(8, 2) },
    { amount: -60, categoryId: "food", date: at(9, 5) },
    { amount: -500, categoryId: "rent", date: at(9, 20) },
  ];

  it("weights each row by 1/N so category sums become monthly averages", () => {
    expect(categoryChanges([], averageMonthRows(rows, 2, null))).toEqual([
      { categoryId: "rent", current: 0, previous: 250, diff: -250 },
      { categoryId: "food", current: 0, previous: 50, diff: -50 },
    ]);
  });

  it("keeps only the first days of each month while the period is in progress", () => {
    expect(averageMonthRows(rows, 2, 5)).toEqual([
      { amount: -20, categoryId: "food" },
      { amount: -30, categoryId: "food" },
    ]);
  });

  it("keeps a whole shorter month when the cut day is past its end", () => {
    const feb = [{ amount: -30, categoryId: "food", date: at(2, 28) }];
    expect(averageMonthRows(feb, 1, 31)).toEqual([{ amount: -30, categoryId: "food" }]);
  });
});
