import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/server/db";
import {
  createBudget,
  updateBudget,
  deleteBudget,
  listBudgetsForUser,
  BudgetAccessError,
} from "@/server/services/budgets";

const owner = "bud_owner";
const stranger = "bud_stranger";
let accountId: string;
let catId: string;
let groupId: string;

beforeAll(async () => {
  for (const id of [owner, stranger]) {
    await db.user.deleteMany({ where: { id } });
    await db.user.create({ data: { id, email: `${id}@bilan.local` } });
  }
  accountId = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } })
  ).id;
  catId = (await db.category.create({ data: { userId: owner, name: "Courses" } })).id;
  const g = await db.group.create({ data: { name: "Foyer Bud", createdById: owner } });
  groupId = g.id;
  await db.groupMember.create({ data: { groupId, userId: owner, role: "OWNER" } });
});

beforeEach(async () => {
  await db.budget.deleteMany({ where: { OR: [{ userId: owner }, { groupId }] } });
});

afterAll(async () => {
  await db.budget.deleteMany({ where: { OR: [{ userId: owner }, { groupId }] } });
  await db.category.deleteMany({ where: { userId: owner } });
  await db.groupMember.deleteMany({ where: { groupId } });
  await db.group.deleteMany({ where: { id: groupId } });
  await db.bankAccount.deleteMany({ where: { ownerId: { in: [owner, stranger] } } });
  await db.user.deleteMany({ where: { id: { in: [owner, stranger] } } });
  await db.$disconnect();
});

const baseInput = {
  name: "Mars",
  periodType: "MONTH" as const,
  periodStart: "2026-03-01",
  periodEnd: "2026-03-31",
  lines: [{ categoryId: undefined, accountId: undefined, plannedAmount: 300 }],
};

describe("createBudget", () => {
  it("creates a personal budget with lines and a UTC-bounded period", async () => {
    const { id } = await createBudget(
      { ...baseInput, lines: [{ categoryId: catId, plannedAmount: 300 }] },
      { id: owner },
    );
    const row = await db.budget.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    expect(row.userId).toBe(owner);
    expect(row.groupId).toBeNull();
    expect(row.periodStart.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(row.periodEnd.toISOString()).toBe("2026-03-31T23:59:59.999Z");
    expect(row.lines).toHaveLength(1);
    expect(Number(row.lines[0].plannedAmount)).toBe(300);
  });

  it("creates a group budget when the actor is a group ADMIN/OWNER", async () => {
    const { id } = await createBudget({ ...baseInput, groupId }, { id: owner });
    const row = await db.budget.findUniqueOrThrow({ where: { id } });
    expect(row.groupId).toBe(groupId);
    expect(row.userId).toBeNull();
  });

  it("rejects a group budget for a non-member", async () => {
    await expect(createBudget({ ...baseInput, groupId }, { id: stranger })).rejects.toBeInstanceOf(
      BudgetAccessError,
    );
  });

  it("rejects a budget with no lines", async () => {
    await expect(createBudget({ ...baseInput, lines: [] }, { id: owner })).rejects.toBeInstanceOf(
      BudgetAccessError,
    );
  });

  it("rejects periodEnd before periodStart", async () => {
    await expect(
      createBudget({ ...baseInput, periodStart: "2026-03-31", periodEnd: "2026-03-01" }, { id: owner }),
    ).rejects.toBeInstanceOf(BudgetAccessError);
  });
});

describe("listBudgetsForUser / update / delete", () => {
  it("lists the user's own + their groups' budgets", async () => {
    await createBudget(baseInput, { id: owner });
    await createBudget({ ...baseInput, name: "Foyer Mars", groupId }, { id: owner });
    const list = await listBudgetsForUser(owner);
    expect(list.some((b) => b.name === "Mars" && b.scope === "USER")).toBe(true);
    expect(list.some((b) => b.name === "Foyer Mars" && b.scope === "GROUP")).toBe(true);
    // A stranger sees neither.
    expect(await listBudgetsForUser(stranger)).toHaveLength(0);
  });

  it("updates name + lines, replacing the line set", async () => {
    const { id } = await createBudget(baseInput, { id: owner });
    await updateBudget(id, { ...baseInput, name: "Mars v2", lines: [{ plannedAmount: 500 }] }, { id: owner });
    const row = await db.budget.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    expect(row.name).toBe("Mars v2");
    expect(row.lines).toHaveLength(1);
    expect(Number(row.lines[0].plannedAmount)).toBe(500);
  });

  it("forbids updating/deleting a budget the actor does not own", async () => {
    const { id } = await createBudget(baseInput, { id: owner });
    await expect(updateBudget(id, baseInput, { id: stranger })).rejects.toBeInstanceOf(BudgetAccessError);
    await expect(deleteBudget(id, { id: stranger })).rejects.toBeInstanceOf(BudgetAccessError);
    await deleteBudget(id, { id: owner });
    expect(await db.budget.findUnique({ where: { id } })).toBeNull();
  });
});
