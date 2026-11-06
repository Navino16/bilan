import { describe, it, expect } from "vitest";
import { exceptionalExpenses } from "@/lib/exceptional";
import type { CategoryBranch, DatedRow, HistoryWindow, MerchantRow } from "@/lib/insights";

// November 2025 to October 2026, October being the period.
const months = Array.from({ length: 12 }, (_, i) => ({
  year: i < 2 ? 2025 : 2026,
  month: ((i + 10) % 12) + 1,
}));
const window: HistoryWindow = { months, inProgress: false, dataStart: 0 };
const at = (i: number, day = 10) => new Date(Date.UTC(months[i].year, months[i].month - 1, day));
const OCT = 11;

const branches = new Map<string, CategoryBranch>([
  ["transport", { root: "transport", child: "transport" }],
  ["fuel", { root: "transport", child: "fuel" }],
  ["upkeep", { root: "transport", child: "upkeep" }],
  ["food", { root: "food", child: "food" }],
  ["groceries", { root: "food", child: "groceries" }],
]);

const spend = (
  id: string,
  label: string,
  amount: number,
  categoryId: string | null,
  date = at(OCT),
  type = "CARD",
): MerchantRow => ({ id, label, amount: -amount, categoryId, date, type });
const period: MerchantRow[] = [
  spend("fuel-1", "CB TOTAL", 60, "fuel"),
  spend("fuel-2", "CB ESSO", 90, "fuel", at(OCT, 20)),
  spend("upkeep-1", "CB NORAUTO 12/10", 300, "upkeep", at(OCT, 12)),
  spend("upkeep-2", "CB CONTROLE TECHNIQUE", 80, "upkeep"),
  spend("upkeep-3", "CB LAVAGE", 45, "upkeep"),
  ...[1, 2, 3, 4].map((n) => spend(`groc-${n}`, "CB LIDL", 100, "groceries")),
  spend("paypal", "PAYPAL *VINTED", 120, null),
];
const history: DatedRow[] = [
  ...months.slice(0, OCT).flatMap((_, i) => [
    { amount: -60, categoryId: "fuel", date: at(i) },
    { amount: -400, categoryId: "groceries", date: at(i) },
    { amount: -20, categoryId: null, date: at(i) },
  ]),
  ...period,
];
const SPENDING = 2000;

const run = (
  rows = period,
  opts: { recurring?: Set<string>; aliases?: Map<string, string>; window?: HistoryWindow } = {},
) =>
  exceptionalExpenses(
    rows,
    history,
    opts.window ?? window,
    branches,
    opts.recurring ?? new Set(),
    SPENDING,
    opts.aliases,
  );

describe("exceptionalExpenses", () => {
  it("lists the expenses above their category's monthly average and the minimum, biggest first", () => {
    const { expenses, total, share } = run();
    expect(expenses.map((e) => [e.id, e.amount, e.average])).toEqual([
      // Upkeep has one month of history: judged against Transport, (60×11 + 150 + 425) / 12.
      ["upkeep-1", 300, 102.92],
      // Uncategorized: (20×11 + 120) / 12.
      ["paypal", 120, 28.33],
      // Fuel: (60×11 + 150) / 12.
      ["fuel-2", 90, 67.5],
    ]);
    expect(total).toBe(510);
    expect(share).toBeCloseTo(0.255);
    expect(expenses[0]).toMatchObject({
      label: "NORAUTO",
      search: "NORAUTO",
      date: at(OCT, 12),
      categoryId: "upkeep",
    });
  });

  it("judges a subcategory against its own average once it has three months of history", () => {
    const earlier = [8, 9].map((i) => ({ amount: -40, categoryId: "upkeep", date: at(i) }));
    const { expenses } = exceptionalExpenses(
      period,
      [...history, ...earlier],
      window,
      branches,
      new Set(),
      SPENDING,
    );
    // Upkeep: (40×2 + 425) / 12 = 42.08, so the 80 € inspection now stands out too.
    expect(expenses.map((e) => [e.id, e.average])).toEqual([
      ["upkeep-1", 42.08],
      ["paypal", 28.33],
      ["fuel-2", 67.5],
      ["upkeep-2", 42.08],
    ]);
  });

  it("leaves out recurring payments, transfers and income", () => {
    const rows = [
      ...period,
      spend("rent", "VIR LOYER", 900, null, at(OCT), "TRANSFER"),
      { ...spend("refund", "REMB", 0, null), amount: 500 },
    ];
    const { expenses } = run(rows, { recurring: new Set(["upkeep-1"]) });
    expect(expenses.map((e) => e.id)).toEqual(["paypal", "fuel-2"]);
  });

  it("shows the merchant's alias", () => {
    const { expenses } = run(period, { aliases: new Map([["NORAUTO", "Garage Norauto"]]) });
    expect(expenses[0]).toMatchObject({ label: "Garage Norauto", search: "NORAUTO" });
  });

  it("finds nothing without a complete month of history", () => {
    const first = { ...window, inProgress: true, dataStart: OCT };
    expect(run(period, { window: first })).toEqual({ expenses: [], total: 0, share: 0 });
  });
});
