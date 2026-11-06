import { describe, it, expect } from "vitest";
import {
  averageMonthRows,
  categoryTrends,
  incomeByCategory,
  insightsOverview,
  isStable,
  monthlyCategoryTotals,
  topMerchants,
  uncategorizedSpending,
  type CategoryBranch,
  type HistoryWindow,
  type MerchantRow,
} from "@/lib/insights";

const d = (day: number) => new Date(Date.UTC(2026, 2, day));

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

const at = (y: number, m: number, day = 10) => new Date(Date.UTC(y, m - 1, day));
const window12 = (inProgress = false, dataStart = 0): HistoryWindow => ({
  months: Array.from({ length: 12 }, (_, i) => ({ year: 2026, month: i + 1 })),
  inProgress,
  dataStart,
});

describe("isStable", () => {
  it("is stable below a 0.15 coefficient of variation", () => {
    expect(isStable([800, 800, 810, 790])).toBe(true);
    expect(isStable([900, 300, 600])).toBe(false);
  });

  it("needs three months with spending", () => {
    expect(isStable([800, 800])).toBe(false);
    expect(isStable([0, 0, 0])).toBe(false);
  });
});

describe("insightsOverview", () => {
  const rows = [
    { amount: 2000, categoryId: "pay", date: at(2026, 10) },
    { amount: -2500, categoryId: "rent", date: at(2026, 10) },
    { amount: 2000, categoryId: "pay", date: at(2026, 11) },
    { amount: -500, categoryId: "food", date: at(2026, 11) },
    { amount: 1000, categoryId: "pay", date: at(2026, 12) },
    { amount: -100, categoryId: "food", date: at(2026, 12) },
    { amount: -40, categoryId: "food", date: at(2027, 1) },
  ];

  it("sums income and spending per month, averaged over the complete months since the data", () => {
    const o = insightsOverview(rows, window12(true, 9));
    expect(o.flows.slice(9)).toEqual([
      { income: 2000, expense: 2500 },
      { income: 2000, expense: 500 },
      { income: 1000, expense: 100 },
    ]);
    expect(o.flows[0]).toEqual({ income: 0, expense: 0 });
    expect(o.complete).toBe(2);
    expect(o.average).toEqual({ income: 2000, expense: 1500 });
    expect(o.spendingAbove).toBe(1);
    expect(o.net).toBe(1900);
  });
});

describe("categoryTrends", () => {
  const branches = new Map<string, CategoryBranch>([
    ["food", { root: "food", child: "food" }],
    ["groceries", { root: "food", child: "groceries" }],
    ["organic", { root: "food", child: "groceries" }],
    ["restaurants", { root: "food", child: "restaurants" }],
    ["rent", { root: "rent", child: "rent" }],
    ["fun", { root: "fun", child: "fun" }],
  ]);
  const history = [
    ...[1, 2, 3, 4, 5, 6].map((m) => ({ amount: -800, categoryId: "rent", date: at(2026, m) })),
    ...[1, 2, 3, 4, 5, 6].map((m) => ({
      amount: m % 2 ? -100 : -400,
      categoryId: "groceries",
      date: at(2026, m),
    })),
    { amount: -60, categoryId: null, date: at(2026, 6) },
  ];
  const window: HistoryWindow = { ...window12(), months: window12().months.slice(0, 6) };
  const current = [
    { amount: -300, categoryId: "groceries" },
    { amount: -50, categoryId: "organic" },
    { amount: -80, categoryId: "restaurants" },
    { amount: -800, categoryId: "rent" },
    { amount: -60, categoryId: null },
    { amount: 2000, categoryId: "pay" },
  ];
  const reference = [
    { amount: -200, categoryId: "groceries" },
    { amount: -20, categoryId: "food" },
    { amount: -790, categoryId: "rent" },
    { amount: -30, categoryId: "fun" },
  ];

  it("ranks root categories by change, stable ones last, without the uncategorized", () => {
    const trends = categoryTrends(current, reference, history, window, branches);
    expect(trends.map((t) => [t.categoryId, t.diff, t.stable])).toEqual([
      ["food", 210, false],
      ["fun", -30, false],
      ["rent", 10, true],
    ]);
    expect(trends[0]).toMatchObject({ current: 430, reference: 220, average: 250 });
    expect(trends[0].values).toEqual([100, 400, 100, 400, 100, 400]);
  });

  it("breaks a root down by its children, deeper levels summed into them", () => {
    const [food] = categoryTrends(current, reference, history, window, branches);
    expect(food.children).toEqual([
      { categoryId: "groceries", current: 350, reference: 200, diff: 150 },
      { categoryId: "restaurants", current: 80, reference: 0, diff: 80 },
      { categoryId: "food", current: 0, reference: 20, diff: -20 },
    ]);
  });
});

describe("uncategorizedSpending", () => {
  it("sums the spending without a category", () => {
    expect(
      uncategorizedSpending([
        { amount: -12.5, categoryId: null },
        { amount: 40, categoryId: null },
        { amount: -9, categoryId: "food" },
      ]),
    ).toBe(12.5);
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
    expect(averageMonthRows(rows, 2, null)).toEqual([
      { amount: -20, categoryId: "food" },
      { amount: -30, categoryId: "food" },
      { amount: -250, categoryId: "rent" },
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
