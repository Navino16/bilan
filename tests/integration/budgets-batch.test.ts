import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import {
  assignTransaction,
  createBudget,
  getBudgetDetail,
  listBudgetsForUser,
  listCurrentLandings,
} from "@/server/services/budgets";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { createLink } from "@/server/services/links";
import { periodEndFor } from "@/lib/budgets";

const owner = "budb_owner";
let personal = "";
let shared = "";
let food = "";
let groupId = "";
const budgets: Record<string, string> = {};

async function tx(accountId: string, date: string, amount: number, categoryId: string | null) {
  const s = buildSecureFields({ label: "T", rawLabel: "T" });
  const { tokens, ...fields } = s;
  void tokens;
  return (
    await db.transaction.create({
      data: { accountId, date: new Date(date), amount, type: "OTHER", categoryId, ...fields },
    })
  ).id;
}

async function questions(): Promise<number> {
  const [row] = await db.$queryRaw<{ Value: string }[]>`SHOW GLOBAL STATUS LIKE 'Questions'`;
  return Number(row.Value);
}

async function queriesOfList(): Promise<number> {
  const before = await questions();
  await listBudgetsForUser(owner);
  return (await questions()) - before - 1;
}

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: owner } });
  await db.user.create({ data: { id: owner, email: "budb-owner@bilan.local" } });
  personal = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Perso", type: "CHECKING" } })
  ).id;
  shared = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Joint", type: "CHECKING" } })
  ).id;
  groupId = (await db.group.create({ data: { name: "Foyer BudB", createdById: owner } })).id;
  await db.groupMember.create({ data: { groupId, userId: owner, role: "OWNER" } });
  await db.accountShare.create({
    data: { accountId: shared, groupId, permission: "WRITE", createdById: owner },
  });
  food = (await db.category.create({ data: { userId: owner, name: "Courses" } })).id;

  const month = (name: string, start: string, end: string, categoryId?: string) =>
    createBudget(
      {
        name,
        periodType: "MONTH",
        periodStart: start,
        periodEnd: end,
        lines: [{ categoryId, plannedAmount: 100 }],
      },
      { id: owner },
    );
  budgets.march = (await month("Mars", "2026-03-01", "2026-03-31", food)).id;
  budgets.april = (await month("Avril", "2026-04-01", "2026-04-30", food)).id;
  budgets.year = (
    await createBudget(
      {
        name: "Année",
        periodType: "YEAR",
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
        lines: [{ plannedAmount: 1000 }],
      },
      { id: owner },
    )
  ).id;
  budgets.group = (
    await createBudget(
      {
        name: "Foyer mars",
        groupId,
        periodType: "MONTH",
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
        lines: [{ plannedAmount: 500 }],
      },
      { id: owner },
    )
  ).id;

  await tx(personal, "2026-03-05", -10, food);
  await tx(personal, "2026-03-20", -15, null);
  const aprilFood = await tx(personal, "2026-04-02", -20, food);
  await tx(shared, "2026-03-08", -30, food);
  const sharedRent = await tx(shared, "2026-03-10", -700, null);
  await tx(shared, "2026-04-10", -40, food);
  const refundOut = await tx(shared, "2026-03-12", -50, food);
  const refundIn = await tx(personal, "2026-03-14", 20, food);
  await createLink({ transactionIds: [refundOut, refundIn], userId: owner });

  // An April row pulled into March, a shared row left out of the household budget,
  // a personal row pulled into it: none may leak into another budget.
  await assignTransaction(
    { budgetId: budgets.march, transactionId: aprilFood, mode: "INCLUDE" },
    { id: owner },
  );
  await assignTransaction(
    { budgetId: budgets.group, transactionId: sharedRent, mode: "EXCLUDE" },
    { id: owner },
  );
  await assignTransaction(
    { budgetId: budgets.group, transactionId: aprilFood, mode: "INCLUDE" },
    { id: owner },
  );
});

afterAll(async () => {
  await db.budget.deleteMany({ where: { OR: [{ userId: owner }, { groupId }] } });
  await db.transaction.deleteMany({ where: { accountId: { in: [personal, shared] } } });
  await db.transactionLink.deleteMany({ where: { createdById: owner } });
  await db.accountShare.deleteMany({ where: { groupId } });
  await db.category.deleteMany({ where: { userId: owner } });
  await db.bankAccount.deleteMany({ where: { ownerId: owner } });
  await db.groupMember.deleteMany({ where: { groupId } });
  await db.group.deleteMany({ where: { id: groupId } });
  await db.user.deleteMany({ where: { id: owner } });
  await db.$disconnect();
});

describe("listBudgetsForUser batch loading (#299)", () => {
  it("gives every budget the spend of its own detail", async () => {
    const list = await listBudgetsForUser(owner);
    expect(list).toHaveLength(4);
    for (const b of list) {
      expect(b.spentTotal).toBe((await getBudgetDetail(b.id, owner)).spentTotal);
    }
    const spent = Object.fromEntries(list.map((b) => [b.id, b.spentTotal]));
    // March food: 10 + 30 + the linked pair's net 30 + the included April 20.
    expect(spent[budgets.march]).toBe(90);
    expect(spent[budgets.april]).toBe(60);
    // Household March: shared food 30 + the half of the pair on a shared account 50 + the included 20.
    expect(spent[budgets.group]).toBe(100);
    expect(spent[budgets.year]).toBe(845);
  });

  it("runs as many queries for many budgets as for one", async () => {
    const recurringMonth = (start: string, end: string) =>
      createBudget(
        {
          name: `Mois ${start}`,
          periodType: "MONTH",
          periodStart: start,
          periodEnd: end,
          recurring: true,
          lines: [{ categoryId: food, plannedAmount: 100 }],
        },
        { id: owner },
      );
    await recurringMonth("2025-05-01", "2025-05-31");
    await queriesOfList();
    const before = await queriesOfList();
    await recurringMonth("2025-06-01", "2025-06-30");
    await recurringMonth("2025-07-01", "2025-07-31");
    await recurringMonth("2025-08-01", "2025-08-31");
    expect(await queriesOfList()).toBe(before);
  });

  it("runs as many queries for many attached budgets as for one", async () => {
    const attachedMonth = async (month: string) => {
      await tx(personal, `${month}-05`, -10, food);
      await tx(personal, `${month}-06`, -5, null);
      await createBudget(
        {
          name: `Compte ${month}`,
          periodType: "MONTH",
          periodStart: `${month}-01`,
          periodEnd: periodEndFor("MONTH", `${month}-01`)!,
          accountId: personal,
          lines: [
            { categoryId: food, plannedAmount: 100 },
            { kind: "TRANSFER", direction: "OUT", counterpartAccountId: shared, plannedAmount: 50 },
          ],
        },
        { id: owner },
      );
    };
    await attachedMonth("2024-05");
    const out = await tx(personal, "2024-05-07", -7, null);
    await createLink({
      transactionIds: [out, await tx(shared, "2024-05-07", 7, null)],
      userId: owner,
    });
    await queriesOfList();
    const before = await queriesOfList();
    for (const month of ["2024-06", "2024-07", "2024-08"]) await attachedMonth(month);
    expect(await queriesOfList()).toBe(before);
  });

  it("computes the current landings in as many queries for many accounts as for one", async () => {
    const now = new Date("2023-03-15T12:00:00.000Z");
    const attached = (accountId: string, counterpartAccountId: string) =>
      createBudget(
        {
          name: `Atterrissage ${accountId}`,
          periodType: "MONTH",
          periodStart: "2023-03-01",
          periodEnd: "2023-03-31",
          accountId,
          lines: [
            { categoryId: food, plannedAmount: 100 },
            { kind: "TRANSFER", direction: "OUT", counterpartAccountId, plannedAmount: 50 },
          ],
        },
        { id: owner },
      );
    const queriesOfLandings = async () => {
      const before = await questions();
      const lands = await listCurrentLandings(owner, now);
      return { lands, queries: (await questions()) - before - 1 };
    };
    await tx(personal, "2023-03-05", -10, food);
    await tx(shared, "2023-03-06", -20, food);
    await attached(personal, shared);
    await queriesOfLandings();
    const one = await queriesOfLandings();
    expect(one.lands).toHaveLength(1);
    await attached(shared, personal);
    const two = await queriesOfLandings();
    expect(two.lands).toHaveLength(2);
    expect(two.queries).toBe(one.queries);
  });
});
