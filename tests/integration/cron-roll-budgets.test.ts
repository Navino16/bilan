import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { listRollableTemplates, rollRecurringSystem } from "@/server/services/budgets";

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

  it("rolls the budget once and is idempotent on a second run", async () => {
    const first = await rollRecurringSystem(budgetId);
    expect(first.created).toBe(true);

    const second = await rollRecurringSystem(budgetId);
    expect(second.created).toBe(false);

    const instances = await db.budget.count({ where: { parentBudgetId: budgetId } });
    expect(instances).toBe(1);
  });
});
