import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { listRollableTemplates, rollRecurringBudgets } from "@/server/services/budgets";

const userId = "roll_owner";
let budgetId: string;

beforeAll(async () => {
  await db.budget.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.user.create({ data: { id: userId, email: "roll@bilan.local" } });
  budgetId = (
    await db.budget.create({
      data: {
        name: "Rollme",
        userId,
        createdById: userId,
        periodType: "MONTH",
        periodStart: new Date("2026-02-01T00:00:00.000Z"),
        periodEnd: new Date("2026-02-28T23:59:59.000Z"),
        recurring: true,
      },
    })
  ).id;
});

afterAll(async () => {
  await db.budget.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

describe("recurring-budget roll cron", () => {
  it("lists an ended recurring budget with no next instance as rollable", async () => {
    const templates = await listRollableTemplates(new Date("2026-03-15T00:00:00.000Z"));
    expect(templates.map((t) => t.id)).toContain(budgetId);
  });

  it("rolls the budget once, with its lines and audit, and is idempotent on a second run", async () => {
    await db.budgetLine.create({ data: { budgetId, plannedAmount: 120, label: "Tout" } });
    const now = new Date("2026-03-15T00:00:00.000Z");
    const first = await rollRecurringBudgets(now);
    expect(first.rolled).toBeGreaterThanOrEqual(1);
    expect((await rollRecurringBudgets(now)).rolled).toBe(0);

    const instances = await db.budget.findMany({
      where: { parentBudgetId: budgetId },
      include: { lines: true },
    });
    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({
      name: "Rollme",
      userId,
      createdById: userId,
      recurring: true,
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
    });
    expect(instances[0].lines.map((l) => [l.label, Number(l.plannedAmount)])).toEqual([
      ["Tout", 120],
    ]);
    const audit = await db.auditLog.findFirst({ where: { entityId: instances[0].id } });
    expect(audit).toMatchObject({
      userId: null,
      action: "budget.created",
      metadata: { rolledFrom: budgetId, system: true },
    });
  });
});
