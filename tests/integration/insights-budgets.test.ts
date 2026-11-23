import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import {
  archiveBudget,
  createBudget,
  listBudgetSeriesHistory,
  listBudgetsForUser,
  rollRecurring,
} from "@/server/services/budgets";
import { getInsights } from "@/server/services/dashboard/insights";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { createLink } from "@/server/services/links";
import { comparisonFor, monthPeriod } from "@/lib/period";

const owner = "bhist_owner";
const stranger = "bhist_stranger";
const now = new Date("2026-06-15T12:00:00.000Z");
let courant = "";
let joint = "";
let food = "";
let groupId = "";
let otherGroupId = "";

async function tx(accountId: string, date: string, amount: number, categoryId: string | null) {
  const s = buildSecureFields({ label: "T", rawLabel: "T" });
  const { tokens, ...fields } = s;
  void tokens;
  return (
    await db.transaction.create({
      data: {
        accountId,
        date: new Date(`${date}T12:00:00.000Z`),
        amount,
        type: "CARD",
        categoryId,
        ...fields,
      },
    })
  ).id;
}

// Creates the template, then rolls each period into the next `rolls` times.
async function series(
  actor: string,
  input: Parameters<typeof createBudget>[0],
  rolls: number,
): Promise<string[]> {
  const ids = [(await createBudget({ ...input, recurring: true }, { id: actor })).id];
  for (let i = 0; i < rolls; i++)
    ids.push((await rollRecurring(ids[ids.length - 1], { id: actor })).id!);
  return ids;
}

const ids: Record<string, string[]> = {};

async function cleanup() {
  const groups = await db.group.findMany({
    where: { createdById: { in: [owner, stranger] } },
    select: { id: true },
  });
  const gids = groups.map((g) => g.id);
  await db.budget.deleteMany({
    where: { OR: [{ userId: { in: [owner, stranger] } }, { groupId: { in: gids } }] },
  });
  await db.transactionLink.deleteMany({ where: { createdById: owner } });
  await db.transaction.deleteMany({ where: { account: { ownerId: { in: [owner, stranger] } } } });
  await db.accountShare.deleteMany({ where: { groupId: { in: gids } } });
  await db.category.deleteMany({ where: { userId: { in: [owner, stranger] } } });
  await db.bankAccount.deleteMany({ where: { ownerId: { in: [owner, stranger] } } });
  await db.groupMember.deleteMany({ where: { groupId: { in: gids } } });
  await db.group.deleteMany({ where: { id: { in: gids } } });
  await db.user.deleteMany({ where: { id: { in: [owner, stranger] } } });
}

beforeAll(async () => {
  await cleanup();
  await db.user.createMany({
    data: [
      { id: owner, email: "bhist-owner@bilan.local" },
      { id: stranger, email: "bhist-stranger@bilan.local" },
    ],
  });
  courant = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } })
  ).id;
  joint = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Joint", type: "CHECKING" } })
  ).id;
  food = (await db.category.create({ data: { userId: owner, name: "Courses" } })).id;
  groupId = (await db.group.create({ data: { name: "Foyer BHist", createdById: owner } })).id;
  await db.groupMember.create({ data: { groupId, userId: owner, role: "OWNER" } });
  await db.accountShare.create({
    data: { accountId: joint, groupId, permission: "WRITE", createdById: owner },
  });
  otherGroupId = (await db.group.create({ data: { name: "Autre BHist", createdById: stranger } }))
    .id;
  await db.groupMember.create({ data: { groupId: otherGroupId, userId: stranger, role: "OWNER" } });

  // Jan → Jul 2026, July still to come on the 15th of June.
  ids.food = await series(
    owner,
    {
      name: "Courses",
      periodType: "MONTH",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      lines: [{ categoryId: food, plannedAmount: 100 }],
    },
    6,
  );
  await tx(courant, "2026-01-10", -130, food);
  await tx(courant, "2026-02-10", -80, food);
  await tx(courant, "2026-03-10", -100, food);
  await tx(courant, "2026-04-10", -50, food);
  // A refund linked across months nets in May, where the purchase is (#413).
  const purchase = await tx(courant, "2026-05-28", -200, food);
  const refund = await tx(courant, "2026-06-02", 40, food);
  await createLink({ transactionIds: [purchase, refund], userId: owner });
  await tx(courant, "2026-06-05", -30, food);

  // 17 weeks from Monday 2 March: the 16th is in progress, the 17th to come.
  ids.weekly = await series(
    owner,
    {
      name: "Foyer semaine",
      groupId,
      periodType: "WEEK",
      periodStart: "2026-03-02",
      periodEnd: "2026-03-08",
      lines: [{ plannedAmount: 50 }],
    },
    16,
  );
  await tx(joint, "2026-06-03", -75, null);

  // One finished period left once May is archived: not shown.
  ids.outings = await series(
    owner,
    {
      name: "Sorties",
      periodType: "MONTH",
      periodStart: "2026-04-01",
      periodEnd: "2026-04-30",
      lines: [{ plannedAmount: 80 }],
    },
    1,
  );
  await archiveBudget(ids.outings[1], { id: owner });
  await createBudget(
    {
      name: "Ponctuel",
      periodType: "MONTH",
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      lines: [{ plannedAmount: 10 }],
    },
    { id: owner },
  );
  await series(
    stranger,
    {
      name: "Pas à moi",
      groupId: otherGroupId,
      periodType: "MONTH",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      lines: [{ plannedAmount: 10 }],
    },
    4,
  );
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("listBudgetSeriesHistory", () => {
  it("lists the readable series with two finished periods, newest first", async () => {
    const history = await listBudgetSeriesHistory(owner, now);
    expect(history.map((s) => [s.name, s.group, s.id])).toEqual([
      ["Foyer semaine", true, ids.weekly[15]],
      ["Courses", false, ids.food[5]],
    ]);
  });

  it("gives each period the budget list's figures, the period in progress apart", async () => {
    const [, food] = await listBudgetSeriesHistory(owner, now);
    expect(food.periods.map((p) => [p.id, p.planned, p.spent, p.status, p.inProgress])).toEqual([
      [ids.food[0], 100, 130, "OVER", false],
      [ids.food[1], 100, 80, "WARN", false],
      [ids.food[2], 100, 100, "REACHED", false],
      [ids.food[3], 100, 50, "OK", false],
      [ids.food[4], 100, 160, "OVER", false],
      [ids.food[5], 100, 30, "OK", true],
    ]);
    expect([food.finished, food.over, food.averageGap]).toEqual([5, 2, 4]);

    const list = await listBudgetsForUser(owner, { now });
    const listed = new Map(list.map((b) => [b.id, b]));
    for (const p of food.periods) {
      const b = listed.get(p.id)!;
      expect([p.planned, p.spent, p.percent, p.status]).toEqual([
        b.plannedTotal,
        b.spentTotal,
        b.percent,
        b.status,
      ]);
    }
  });

  it("keeps the latest 12 started periods", async () => {
    const [weekly] = await listBudgetSeriesHistory(owner, now);
    expect(weekly.periods.map((p) => p.id)).toEqual(ids.weekly.slice(4, 16));
    expect(weekly.periods.at(-1)!.inProgress).toBe(true);
    expect([weekly.finished, weekly.over]).toEqual([11, 1]);
    expect(weekly.averageGap).toBe(-43.18);
  });

  it("feeds the insights whatever their period", async () => {
    const period = monthPeriod(2026, 2);
    const { budgets } = await getInsights(owner, period, comparisonFor(period, "prev", now), now);
    expect(budgets.map((s) => s.name)).toEqual(["Foyer semaine", "Courses"]);
  });

  it("is empty without a series to show", async () => {
    expect(await listBudgetSeriesHistory(stranger, new Date("2026-02-15T00:00:00.000Z"))).toEqual(
      [],
    );
  });
});
