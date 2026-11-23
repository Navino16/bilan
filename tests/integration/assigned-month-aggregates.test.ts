import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { getDashboard } from "@/server/services/dashboard";
import { getInsights } from "@/server/services/dashboard/insights";
import { createBudget, getBudgetDetail } from "@/server/services/budgets";
import { comparisonFor, monthPeriod } from "@/lib/period";

const owner = "assigned_agg_owner";
const later = new Date("2026-10-05");
let accountId: string;
let salary: string;
let rent: string;
let shiftedRent: string;

async function tx(
  date: string,
  periodDate: string,
  amount: number,
  label: string,
  categoryId: string,
): Promise<string> {
  const s = buildSecureFields({ label, rawLabel: label });
  const row = await db.transaction.create({
    data: {
      accountId,
      date: new Date(date),
      periodDate: new Date(periodDate),
      amount,
      type: "TRANSFER",
      labelEnc: s.labelEnc,
      labelHash: s.labelHash,
      rawLabelEnc: s.rawLabelEnc,
      rawLabelHash: s.rawLabelHash,
      merchantKeyHash: s.merchantKeyHash,
      categoryId,
      createdById: owner,
    },
  });
  return row.id;
}

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: owner } });
  await db.user.create({ data: { id: owner, email: "assigned-agg@bilan.local" } });
  accountId = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } })
  ).id;
  salary = (await db.category.create({ data: { userId: owner, name: "Salaire" } })).id;
  rent = (await db.category.create({ data: { userId: owner, name: "Loyer" } })).id;
  await tx("2026-02-27T00:00:00.000Z", "2026-03-01T00:00:00.000Z", 2000, "VIR PAIE", salary);
  shiftedRent = await tx(
    "2026-02-27T00:00:00.000Z",
    "2026-03-01T00:00:00.000Z",
    -700,
    "VIR LOYER",
    rent,
  );
});

afterAll(async () => {
  await db.budget.deleteMany({ where: { userId: owner } });
  await db.transaction.deleteMany({ where: { accountId } });
  await db.category.deleteMany({ where: { userId: owner } });
  await db.bankAccount.deleteMany({ where: { ownerId: owner } });
  await db.user.deleteMany({ where: { id: owner } });
  await db.$disconnect();
});

describe("aggregates bucket on the assigned month", () => {
  it("counts a shifted transaction in its assigned month on the dashboard", async () => {
    const march = monthPeriod(2026, 3);
    const data = await getDashboard(owner, march, comparisonFor(march, "prev", later));
    expect(data.totals.income).toBe(2000);
    expect(data.totals.expense).toBe(700);
    expect(data.previous.income).toBe(0);

    const feb = monthPeriod(2026, 2);
    const febData = await getDashboard(owner, feb, comparisonFor(feb, "prev", later));
    expect(febData.totals.income).toBe(0);
  });

  it("keeps the dashboard's recent list on the real date", async () => {
    const feb = monthPeriod(2026, 2);
    const febData = await getDashboard(owner, feb, comparisonFor(feb, "prev", later));
    expect(febData.recent).toHaveLength(2);
  });

  it("counts it in the assigned month's insights", async () => {
    const march = monthPeriod(2026, 3);
    const data = await getInsights(owner, march, comparisonFor(march, "prev", later));
    expect(data.incomeTotal).toBe(2000);
  });

  it("counts it in the assigned month's budget, listed with both dates", async () => {
    const budget = (start: string, end: string) =>
      createBudget(
        {
          name: start,
          periodType: "MONTH",
          periodStart: start,
          periodEnd: end,
          lines: [{ categoryId: rent, plannedAmount: 800 }],
        },
        { id: owner },
      );
    const march = await getBudgetDetail((await budget("2026-03-01", "2026-03-31")).id, owner);
    expect(march.lines[0].spent).toBe(700);
    const row = march.transactions.find((t) => t.id === shiftedRent)!;
    expect(row.date.toISOString()).toBe("2026-02-27T00:00:00.000Z");
    expect(row.periodDate.toISOString()).toBe("2026-03-01T00:00:00.000Z");

    const feb = await getBudgetDetail((await budget("2026-02-01", "2026-02-28")).id, owner);
    expect(feb.lines[0].spent).toBe(0);
  });
});
