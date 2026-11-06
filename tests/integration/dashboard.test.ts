import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { getDashboard } from "@/server/services/dashboard";
import { createLink } from "@/server/services/links";
import { comparisonFor, monthPeriod } from "@/lib/period";

const owner = "dash_owner";
let accountId: string;
let catA: string;
let catB: string;

async function tx(date: string, amount: number, label: string, categoryId: string | null) {
  const s = buildSecureFields({ label, rawLabel: label });
  await db.transaction.create({
    data: {
      accountId,
      date: new Date(date),
      amount,
      type: "OTHER",
      labelEnc: s.labelEnc,
      labelHash: s.labelHash,
      rawLabelEnc: s.rawLabelEnc,
      rawLabelHash: s.rawLabelHash,
      categoryId,
      createdById: owner,
    },
  });
}

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: owner } });
  await db.user.create({ data: { id: owner, email: "dash-owner@bilan.local" } });
  accountId = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } })
  ).id;
  catA = (await db.category.create({ data: { userId: owner, name: "Courses", color: "#11aa11" } }))
    .id;
  catB = (await db.category.create({ data: { userId: owner, name: "Loyer", color: "#aa1111" } }))
    .id;
  // March 2026
  await tx("2026-03-02T00:00:00.000Z", -40, "CB CARREFOUR", catA);
  await tx("2026-03-02T00:00:00.000Z", -10, "CB FRANPRIX", catA);
  await tx("2026-03-05T00:00:00.000Z", -700, "VIR LOYER", catB);
  await tx("2026-03-10T00:00:00.000Z", 2000, "VIR SALAIRE", null);
  // February 2026 (previous month) — for the delta
  await tx("2026-02-10T00:00:00.000Z", 1000, "VIR SALAIRE", null);
  await tx("2026-02-12T00:00:00.000Z", -500, "VIR LOYER", catB);
});

afterAll(async () => {
  await db.transaction.deleteMany({ where: { accountId } });
  await db.category.deleteMany({ where: { userId: owner } });
  await db.bankAccount.deleteMany({ where: { ownerId: owner } });
  await db.user.deleteMany({ where: { id: owner } });
  await db.$disconnect();
});

const later = new Date("2026-10-05");

describe("getDashboard", () => {
  it("totals income/expense/net for the month and the previous month", async () => {
    const period = monthPeriod(2026, 3);
    const data = await getDashboard(owner, period, comparisonFor(period, "prev", later));
    expect(data.totals.income).toBe(2000);
    expect(data.totals.expense).toBe(750); // 40 + 10 + 700
    expect(data.totals.net).toBe(1250);
    expect(data.totals.count).toBe(4);
    expect(data.previous.income).toBe(1000);
    expect(data.previous.expense).toBe(500);
    expect(data.previous.net).toBe(500);
  });

  it("groups expenses by category, highest first", async () => {
    const period = monthPeriod(2026, 3);
    const data = await getDashboard(owner, period, comparisonFor(period, "prev", later));
    expect(data.byCategory[0]).toEqual({ categoryId: catB, amount: 700 });
    expect(data.byCategory[1]).toEqual({ categoryId: catA, amount: 50 });
  });

  it("returns the cumulative spending pace against the previous month, and recent transactions", async () => {
    const period = monthPeriod(2026, 3);
    const data = await getDashboard(owner, period, comparisonFor(period, "prev", later), later);
    const { pace } = data;
    expect(pace).toMatchObject({ granularity: "day", start: "2026-03-01", buckets: 31 });
    expect(pace.asOf).toBe("2026-03-31");
    expect(pace.current).toHaveLength(31);
    expect([pace.current[0], pace.current[1], pace.current[4], pace.current[30]]).toEqual([
      0, 50, 750, 750,
    ]);
    // February by day offset, its 28 days spread over March's 31 buckets.
    expect(pace.reference).toHaveLength(31);
    expect([pace.reference![10], pace.reference![11], pace.reference![30]]).toEqual([0, 500, 500]);
    expect(data.recent.length).toBeGreaterThan(0);
    expect(data.recent[0].label).toBeTruthy(); // decrypted
  });

  it("goes by month over a quarter, without a reference when the previous one is empty", async () => {
    const q1 = {
      from: new Date("2026-01-01T00:00:00.000Z"),
      to: new Date("2026-03-31T23:59:59.999Z"),
      year: null,
      month: null,
    };
    const { pace } = await getDashboard(owner, q1, comparisonFor(q1, "prev", later), later);
    expect(pace).toMatchObject({ granularity: "month", buckets: 3, asOf: "2026-03-31" });
    expect(pace.current).toEqual([0, 500, 1250]);
    expect(pace.reference).toBeNull();
  });

  it("counts the uncategorized operations of the period per direction", async () => {
    const period = monthPeriod(2026, 3);
    const data = await getDashboard(owner, period, comparisonFor(period, "prev", later), later);
    expect(data.uncategorized).toEqual({
      out: { count: 0, amount: 0 },
      in: { count: 1, amount: 2000 },
    });
  });
});

describe("getDashboard comparison baselines", () => {
  const period = monthPeriod(2026, 3);

  it("averages only the months since the first transaction", async () => {
    // Dec–Feb, but nothing was recorded before February: Feb alone is the average.
    const data = await getDashboard(owner, period, comparisonFor(period, "avg3", later));
    expect(data.previous).toEqual({ income: 1000, expense: 500, net: 500 });
  });

  it("stops the pace at today while the month is in progress", async () => {
    const now = new Date("2026-03-10T12:00:00Z");
    const { pace } = await getDashboard(owner, period, comparisonFor(period, "prev", now), now);
    expect(pace.asOf).toBe("2026-03-10");
    expect(pace.current).toHaveLength(10);
    expect(pace.current[9]).toBe(750);
    // The reference stays whole, past today.
    expect(pace.reference![30]).toBe(500);
  });

  it("averages the reference pace over the recorded months", async () => {
    const { pace } = await getDashboard(owner, period, comparisonFor(period, "avg3", later), later);
    // Only February holds data: the average is February itself, by day of the month.
    expect([pace.reference![10], pace.reference![11]]).toEqual([0, 500]);
  });

  it("cuts the previous month to the same days while the month is in progress", async () => {
    const data = await getDashboard(
      owner,
      period,
      comparisonFor(period, "prev", new Date("2026-03-08T12:00:00Z")),
    );
    expect(data.previous).toEqual({ income: 0, expense: 0, net: 0 });
    expect(data.totals.expense).toBe(750);
  });
});

describe("getDashboard link-aware totals", () => {
  it("excludes a balanced link and collapses an unbalanced one to its net", async () => {
    // April 2026, isolated from the other tests' March data.
    const period = monthPeriod(2026, 4);

    // Balanced refund pair (−50 / +50) → must NOT affect totals.
    await tx("2026-04-03T00:00:00.000Z", -50, "CB BALANCED", catA);
    await tx("2026-04-04T00:00:00.000Z", 50, "REMB BALANCED", null);

    // Unbalanced pair (−80 spend / +30 partial refund) → net −50 on the primary (catB).
    await tx("2026-04-10T00:00:00.000Z", -80, "CB PARTIAL", catB);
    await tx("2026-04-12T00:00:00.000Z", 30, "REMB PARTIAL", null);

    const all = await db.transaction.findMany({
      where: { accountId, date: { gte: period.from, lte: period.to } },
      select: { id: true, amount: true },
    });
    const find = (amt: number) => all.find((r) => Number(r.amount) === amt)!.id;
    await createLink({ transactionIds: [find(-50), find(50)], userId: owner });
    await createLink({ transactionIds: [find(-80), find(30)], userId: owner });

    const data = await getDashboard(owner, period, comparisonFor(period, "prev", later));
    // Balanced pair contributes nothing; unbalanced collapses to a −50 expense.
    expect(data.totals.income).toBe(0);
    expect(data.totals.expense).toBe(50);
    expect(data.totals.net).toBe(-50);
    // count reflects the REAL transactions in the period (4), not collapsed rows.
    expect(data.totals.count).toBe(4);
    // The collapsed −50 lands on catB (the primary's category).
    expect(data.byCategory).toEqual([{ categoryId: catB, amount: 50 }]);

    // Cleanup so other tests' assumptions about the dataset hold.
    await db.transactionLinkMember.deleteMany({});
    await db.transactionLink.deleteMany({});
    await db.transaction.deleteMany({
      where: { accountId, date: { gte: period.from, lte: period.to } },
    });
  });

  it("evaluates a link whose members fall in different months as a whole", async () => {
    // Balanced pair across July/August, unbalanced pair (primary −80 in September).
    await tx("2026-07-31T00:00:00.000Z", 187, "VIR RECU", null);
    await tx("2026-08-01T00:00:00.000Z", -187, "VIR RENDU", catA);
    await tx("2026-08-31T00:00:00.000Z", 30, "REMB PARTIAL", null);
    await tx("2026-09-01T00:00:00.000Z", -80, "CB PARTIAL", catB);
    const all = await db.transaction.findMany({
      where: { accountId, date: { gte: new Date("2026-07-01"), lt: new Date("2026-10-01") } },
      select: { id: true, amount: true },
    });
    const find = (amt: number) => all.find((r) => Number(r.amount) === amt)!.id;
    await createLink({ transactionIds: [find(187), find(-187)], userId: owner });
    await createLink({ transactionIds: [find(-80), find(30)], userId: owner });

    const totals = async (month: number) => {
      const period = monthPeriod(2026, month);
      return getDashboard(owner, period, comparisonFor(period, "prev", later));
    };
    try {
      expect((await totals(7)).totals).toMatchObject({ income: 0, expense: 0, count: 1 });
      expect((await totals(8)).totals).toMatchObject({ income: 0, expense: 0, count: 2 });
      const september = await totals(9);
      expect(september.totals).toMatchObject({ income: 0, expense: 50, count: 1 });
      expect(september.byCategory).toEqual([{ categoryId: catB, amount: 50 }]);
    } finally {
      await db.transactionLinkMember.deleteMany({});
      await db.transactionLink.deleteMany({});
      await db.transaction.deleteMany({ where: { id: { in: all.map((r) => r.id) } } });
    }
  });
});

describe("net savings", () => {
  const saver = "dash_saver";
  let courant: string;
  let livret: string;
  let kids: string;

  async function row(
    account: string,
    day: string,
    amount: number,
    categoryId: string | null = null,
  ) {
    const s = buildSecureFields({ label: "VIR", rawLabel: "VIR" });
    const r = await db.transaction.create({
      data: {
        accountId: account,
        date: new Date(`${day}T00:00:00.000Z`),
        amount,
        type: "TRANSFER",
        labelEnc: s.labelEnc,
        labelHash: s.labelHash,
        rawLabelEnc: s.rawLabelEnc,
        rawLabelHash: s.rawLabelHash,
        categoryId,
        createdById: saver,
      },
    });
    return r.id;
  }

  beforeAll(async () => {
    await db.user.deleteMany({ where: { id: saver } });
    await db.user.create({ data: { id: saver, email: "dash-saver@bilan.local" } });
    courant = (
      await db.bankAccount.create({ data: { ownerId: saver, name: "Courant", type: "CHECKING" } })
    ).id;
    livret = (
      await db.bankAccount.create({ data: { ownerId: saver, name: "Livret", type: "SAVINGS" } })
    ).id;
    const savings = await db.category.create({
      data: { userId: saver, name: "Épargne", savings: true },
    });
    kids = (
      await db.category.create({
        data: { userId: saver, name: "Livrets enfants", parentId: savings.id },
      })
    ).id;
  });

  afterAll(async () => {
    const accounts = [courant, livret];
    await db.transactionLink.deleteMany({
      where: { members: { some: { transaction: { accountId: { in: accounts } } } } },
    });
    await db.transaction.deleteMany({ where: { accountId: { in: accounts } } });
    await db.category.deleteMany({ where: { userId: saver, parentId: { not: null } } });
    await db.category.deleteMany({ where: { userId: saver } });
    await db.bankAccount.deleteMany({ where: { ownerId: saver } });
    await db.user.deleteMany({ where: { id: saver } });
  });

  const march = monthPeriod(2026, 3);
  const dashboard = () => getDashboard(saver, march, comparisonFor(march, "prev", later));

  it("is zero without savings activity", async () => {
    expect((await dashboard()).savings.current).toBe(0);
  });

  it("adds transfers into savings and savings-category spending, minus transfers back", async () => {
    const out = await row(courant, "2026-03-03", -300);
    const into = await row(livret, "2026-03-04", 300);
    await createLink({ transactionIds: [out, into], userId: saver });
    const back = await row(courant, "2026-03-20", 100);
    const from = await row(livret, "2026-03-19", -100);
    await createLink({ transactionIds: [back, from], userId: saver });
    await row(courant, "2026-03-05", -50, kids);

    const data = await dashboard();
    expect(data.savings.current).toBe(250);
    // The linked transfers stay out of income and expenses, savings-category spending too.
    expect([data.totals.income, data.totals.expense]).toEqual([0, 0]);
    expect(data.byCategory).toEqual([]);
    expect(data.pace.current[30]).toBe(0);
  });

  it("averages savings over recorded months cut to the elapsed days", async () => {
    const april = monthPeriod(2026, 4);
    const data = await getDashboard(
      saver,
      april,
      comparisonFor(april, "avg3", new Date("2026-04-05T12:00:00.000Z")),
    );
    // March up to the 5th: +300 into the livret and 50 to the kids' savings; no data before March.
    expect(data.savings.previous).toBe(350);
    expect(data.previous.expense).toBe(0);
  });

  it("counts a savings-category transfer once while its savings leg is unlinked", async () => {
    await row(courant, "2026-05-03", -80, kids);
    await row(livret, "2026-05-04", 80);
    const may = monthPeriod(2026, 5);
    const data = await getDashboard(saver, may, comparisonFor(may, "prev", later));
    // Only the checking row counts (savings-category spending); an unlinked savings leg doesn't.
    expect(data.savings.current).toBe(80);
    expect(data.totals.expense).toBe(0);
  });
});
