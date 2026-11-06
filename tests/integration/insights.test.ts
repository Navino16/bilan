import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { getInsights } from "@/server/services/dashboard/insights";
import { createLink } from "@/server/services/links";
import { comparisonFor, monthPeriod } from "@/lib/period";
import { deleteAliasGroup, renameMerchant } from "@/server/services/merchants";

const owner = "insights_owner";
let accountId: string;
let food: string;
let organic: string;
let rent: string;
let pay: string;

async function tx(
  date: string,
  amount: number,
  label: string,
  categoryId: string | null,
  type = "CARD",
): Promise<string> {
  const s = buildSecureFields({ label, rawLabel: label });
  const row = await db.transaction.create({
    data: {
      accountId,
      date: new Date(date),
      amount,
      type,
      labelEnc: s.labelEnc,
      labelHash: s.labelHash,
      rawLabelEnc: s.rawLabelEnc,
      rawLabelHash: s.rawLabelHash,
      categoryId,
      createdById: owner,
    },
  });
  return row.id;
}

async function cleanup() {
  await db.transactionLink.deleteMany({ where: { createdById: owner } });
  await db.transaction.deleteMany({ where: { account: { ownerId: owner } } });
  await db.category.deleteMany({ where: { userId: owner } });
  await db.bankAccount.deleteMany({ where: { ownerId: owner } });
  await db.user.deleteMany({ where: { id: owner } });
}

beforeAll(async () => {
  await cleanup();
  await db.user.create({ data: { id: owner, email: "insights-owner@bilan.local" } });
  accountId = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } })
  ).id;
  const cat = async (
    name: string,
    data: { parentId?: string; savings?: boolean; neutral?: boolean } = {},
  ) => (await db.category.create({ data: { userId: owner, name, color: "#11aa11", ...data } })).id;
  food = await cat("Courses");
  organic = await cat("Bio", { parentId: food });
  rent = await cat("Loyer");
  pay = await cat("Salaire");
  const saved = await cat("Épargne", { savings: true });
  const internal = await cat("Banque", { neutral: true });
  const transfers = await cat("Virement interne", { parentId: internal });

  // March 2026
  await tx("2026-03-02T00:00:00.000Z", -40, "CB CARREFOUR 02/03/26", food);
  await tx("2026-03-15T00:00:00.000Z", -10, "CB CARREFOUR 15/03/26", food);
  await tx("2026-03-20T00:00:00.000Z", -25, "CB BIOCOOP", organic);
  // Savings and neutral rows count neither in spending nor in income.
  await tx("2026-03-07T00:00:00.000Z", -150, "CB AMUNDI", saved);
  await tx("2026-03-08T00:00:00.000Z", -400, "RETRAIT COMPTE JOINT", transfers, "OTHER");
  await tx("2026-03-09T00:00:00.000Z", 400, "VERSEMENT COMPTE JOINT", transfers, "OTHER");
  await tx("2026-03-05T00:00:00.000Z", -700, "PRLV FONCIA LOYER", rent, "DIRECT_DEBIT");
  await tx("2026-03-06T00:00:00.000Z", -300, "VIR LIVRET A", null, "TRANSFER");
  await tx("2026-03-10T00:00:00.000Z", 2000, "VIR SALAIRE", pay, "TRANSFER");
  const purchase = await tx("2026-03-12T00:00:00.000Z", -50, "CB FNAC", food);
  const refund = await tx("2026-03-14T00:00:00.000Z", 50, "REMB FNAC", food, "OTHER");
  await createLink({ transactionIds: [purchase, refund], userId: owner });
  // A balanced link spanning December and January: it must drop out of both months.
  const order = await tx("2025-12-28T00:00:00.000Z", -80, "CB DARTY", food);
  const credit = await tx("2026-01-04T00:00:00.000Z", 80, "REMB DARTY", food, "OTHER");
  await createLink({ transactionIds: [order, credit], userId: owner });
  // February 2026 (previous period)
  await tx("2026-02-05T00:00:00.000Z", -500, "PRLV FONCIA LOYER", rent, "DIRECT_DEBIT");
  await tx("2026-02-08T00:00:00.000Z", -20, "CB FRANPRIX", food);
  await tx("2026-02-10T00:00:00.000Z", 1000, "VIR SALAIRE", pay, "TRANSFER");
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("getInsights", () => {
  const period = monthPeriod(2026, 3);
  const later = new Date("2026-10-05");

  it("compares spending per root category with the previous period, without the uncategorized", async () => {
    const data = await getInsights(owner, period, comparisonFor(period, "prev", later), later);
    expect(
      data.categories.map(({ categoryId, current, reference, diff }) => ({
        categoryId,
        current,
        reference,
        diff,
      })),
    ).toEqual([
      { categoryId: rent, current: 700, reference: 500, diff: 200 },
      { categoryId: food, current: 75, reference: 20, diff: 55 },
    ]);
    expect(data.categories[1].children).toEqual([
      { categoryId: food, current: 50, reference: 20, diff: 30 },
      { categoryId: organic, current: 25, reference: 0, diff: 25 },
    ]);
    expect(data.uncategorized).toBe(300);
  });

  it("charts 12 months of the root's spending, ending at the period's month", async () => {
    const data = await getInsights(owner, period, comparisonFor(period, "prev", later), later);
    const zeros = (n: number) => Array<number>(n).fill(0);
    expect(data.categories.find((c) => c.categoryId === food)?.values).toEqual([
      ...zeros(10),
      20,
      75,
    ]);
    // First transaction on 2025-12-28: the average covers December to March.
    expect(data.categories.find((c) => c.categoryId === rent)?.average).toBe(300);
  });

  it("sums income and spending per month over 12 months, savings and neutral rows left out", async () => {
    const { overview } = await getInsights(
      owner,
      period,
      comparisonFor(period, "prev", later),
      later,
    );
    expect(overview.months[0]).toEqual({ year: 2025, month: 4 });
    expect(overview.months[overview.dataStart]).toEqual({ year: 2025, month: 12 });
    expect(overview.inProgress).toBe(false);
    expect(overview.flows.slice(10)).toEqual([
      { income: 1000, expense: 520 },
      { income: 2000, expense: 1075 },
    ]);
    expect(overview).toMatchObject({
      complete: 4,
      average: { income: 750, expense: 398.75 },
      spendingAbove: 0,
      net: 1405,
    });
  });

  it("flags the last month while it is in progress", async () => {
    const now = new Date("2026-03-20");
    const data = await getInsights(owner, period, comparisonFor(period, "prev", now), now);
    expect(data.overview.inProgress).toBe(true);
    expect(data.overview.complete).toBe(3);
  });

  it("ranks merchants without transfers, balanced links, savings or neutral rows", async () => {
    const data = await getInsights(owner, period, comparisonFor(period, "prev", later), later);
    expect(data.merchants).toEqual([
      expect.objectContaining({ label: "FONCIA LOYER", total: 700, count: 1, categoryId: rent }),
      expect.objectContaining({ label: "CARREFOUR", total: 50, count: 2, categoryId: food }),
      expect.objectContaining({ label: "BIOCOOP", total: 25, count: 1, categoryId: organic }),
    ]);
    expect(data.aliasGroups).toEqual([]);
  });
  it("applies the user's merchant aliases", async () => {
    await renameMerchant(owner, "FONCIA LOYER", "Loyer");
    try {
      const data = await getInsights(owner, period, comparisonFor(period, "prev", later));
      expect(data.merchants[0]).toMatchObject({
        label: "Loyer",
        search: "FONCIA LOYER",
        alias: "Loyer",
        keys: ["FONCIA LOYER"],
      });
      expect(data.aliasGroups).toEqual([{ name: "Loyer", keys: ["FONCIA LOYER"] }]);
    } finally {
      await deleteAliasGroup(owner, "Loyer");
    }
  });

  it("breaks income down by category", async () => {
    const data = await getInsights(owner, period, comparisonFor(period, "prev", later));
    expect(data.income).toEqual([{ categoryId: pay, current: 2000, previous: 1000 }]);
    expect(data.incomeTotal).toBe(2000);
  });
});

describe("getInsights against an N-month average", () => {
  const period = monthPeriod(2026, 3);

  it("compares with the monthly average of the months before, empty months counting as 0", async () => {
    const data = await getInsights(
      owner,
      period,
      comparisonFor(period, "avg3", new Date("2026-10-05")),
    );
    expect(
      data.categories.map(({ categoryId, reference, diff }) => ({ categoryId, reference, diff })),
    ).toEqual([
      { categoryId: rent, reference: 166.67, diff: 533.33 },
      { categoryId: food, reference: 6.67, diff: 68.33 },
    ]);
    expect(data.income).toEqual([{ categoryId: pay, current: 2000, previous: 333.33 }]);
  });

  it("cuts the averaged months to the same days while the month is in progress", async () => {
    const data = await getInsights(
      owner,
      period,
      comparisonFor(period, "avg3", new Date("2026-03-10T12:00:00Z")),
    );
    // December's data starts on the 28th, after the 10 days compared: Jan–Feb only.
    expect(
      data.categories.map(({ categoryId, reference, diff }) => ({ categoryId, reference, diff })),
    ).toEqual([
      { categoryId: rent, reference: 250, diff: 450 },
      { categoryId: food, reference: 10, diff: 65 },
    ]);
  });
});
