import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { getDashboard } from "@/server/services/dashboard";
import { monthPeriod, previousMonthPeriod } from "@/lib/period";

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

describe("getDashboard", () => {
  it("totals income/expense/net for the month and the previous month", async () => {
    const period = monthPeriod(2026, 3);
    const data = await getDashboard(owner, period, previousMonthPeriod(period));
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
    const data = await getDashboard(owner, period, previousMonthPeriod(period));
    expect(data.byCategory[0]).toEqual({ categoryId: catB, amount: 700 });
    expect(data.byCategory[1]).toEqual({ categoryId: catA, amount: 50 });
  });

  it("returns a per-day expense trace and recent transactions for a month", async () => {
    const period = monthPeriod(2026, 3);
    const data = await getDashboard(owner, period, previousMonthPeriod(period));
    expect(data.trace.granularity).toBe("day");
    const day2 = data.trace.points.find((d) => d.date === "2026-03-02");
    expect(day2?.amount).toBe(50);
    expect(data.trace.points).toHaveLength(31); // one entry per day of March
    expect(data.recent.length).toBeGreaterThan(0);
    expect(data.recent[0].label).toBeTruthy(); // decrypted
  });

  it("aggregates the trace by month for periods longer than ~6 weeks", async () => {
    const q1 = {
      from: new Date("2026-01-01T00:00:00.000Z"),
      to: new Date("2026-03-31T23:59:59.999Z"),
      year: null,
      month: null,
    };
    const data = await getDashboard(owner, q1, previousMonthPeriod(monthPeriod(2026, 1)));
    expect(data.trace.granularity).toBe("month");
    expect(data.trace.points).toHaveLength(3); // Jan, Feb, Mar
    expect(data.trace.points.find((p) => p.date === "2026-01-01")?.amount).toBe(0);
    expect(data.trace.points.find((p) => p.date === "2026-02-01")?.amount).toBe(500);
    expect(data.trace.points.find((p) => p.date === "2026-03-01")?.amount).toBe(750);
  });
});
