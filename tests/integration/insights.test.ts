import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { getCategoryHistory, getInsights } from "@/server/services/dashboard/insights";
import { createLink } from "@/server/services/links";
import { comparisonFor, monthPeriod } from "@/lib/period";

const owner = "insights_owner";
let accountId: string;
let food: string;
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
  const cat = async (name: string) =>
    (await db.category.create({ data: { userId: owner, name, color: "#11aa11" } })).id;
  food = await cat("Courses");
  rent = await cat("Loyer");
  pay = await cat("Salaire");

  // March 2026
  await tx("2026-03-02T00:00:00.000Z", -40, "CB CARREFOUR 02/03/26", food);
  await tx("2026-03-15T00:00:00.000Z", -10, "CB CARREFOUR 15/03/26", food);
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

  it("compares expenses per category with the previous period, biggest change first", async () => {
    const data = await getInsights(owner, period, comparisonFor(period, "prev", later));
    expect(data.changes).toEqual([
      { categoryId: null, current: 300, previous: 0, diff: 300 },
      { categoryId: rent, current: 700, previous: 500, diff: 200 },
      { categoryId: food, current: 50, previous: 20, diff: 30 },
    ]);
  });

  it("ranks merchants without transfers or balanced links", async () => {
    const data = await getInsights(owner, period, comparisonFor(period, "prev", later));
    expect(data.merchants).toEqual([
      { label: "FONCIA LOYER", total: 700, count: 1, categoryId: rent },
      { label: "CARREFOUR", total: 50, count: 2, categoryId: food },
    ]);
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
    expect(data.changes).toEqual([
      { categoryId: rent, current: 700, previous: 166.67, diff: 533.33 },
      { categoryId: null, current: 300, previous: 0, diff: 300 },
      { categoryId: food, current: 50, previous: 6.67, diff: 43.33 },
    ]);
    expect(data.income).toEqual([{ categoryId: pay, current: 2000, previous: 333.33 }]);
  });

  it("cuts the averaged months to the same days while the month is in progress", async () => {
    const data = await getInsights(
      owner,
      period,
      comparisonFor(period, "avg3", new Date("2026-03-10T12:00:00Z")),
    );
    expect(data.changes).toEqual([
      { categoryId: rent, current: 700, previous: 166.67, diff: 533.33 },
      { categoryId: null, current: 300, previous: 0, diff: 300 },
      { categoryId: food, current: 50, previous: 6.67, diff: 43.33 },
    ]);
  });
});

describe("getCategoryHistory", () => {
  const zeros = (n: number) => Array<number>(n).fill(0);

  it("totals 12 months of spending per category, ending at the period's month", async () => {
    const h = await getCategoryHistory(owner, monthPeriod(2026, 3), new Date("2026-10-05"));
    expect(h.months[0]).toEqual({ year: 2025, month: 4 });
    expect(h.months[11]).toEqual({ year: 2026, month: 3 });
    expect(h.inProgress).toBe(false);
    expect(h.series).toEqual(
      expect.arrayContaining([
        { categoryId: food, values: [...zeros(10), 20, 50] },
        { categoryId: rent, values: [...zeros(10), 500, 700] },
        { categoryId: null, values: [...zeros(11), 300] },
      ]),
    );
    expect(h.series).toHaveLength(3);
  });

  it("flags the last month while it is in progress", async () => {
    const h = await getCategoryHistory(owner, monthPeriod(2026, 3), new Date("2026-03-20"));
    expect(h.inProgress).toBe(true);
  });
});
