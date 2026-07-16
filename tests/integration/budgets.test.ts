import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/server/db";
import {
  createBudget,
  updateBudget,
  deleteBudget,
  listBudgetsForUser,
  getBudgetDetail,
  assignTransaction,
  unassignTransaction,
  listAssignableBudgets,
  BudgetAccessError,
} from "@/server/services/budgets";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { createLink } from "@/server/services/links";

const owner = "bud_owner";
const stranger = "bud_stranger";
let accountId: string;
let catId: string;
let groupId: string;

async function tx(date: string, amount: number, categoryId: string | null): Promise<string> {
  const s = buildSecureFields({ label: "T", rawLabel: "T" });
  const row = await db.transaction.create({
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
  return row.id;
}

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
      createBudget(
        { ...baseInput, periodStart: "2026-03-31", periodEnd: "2026-03-01" },
        { id: owner },
      ),
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
    await updateBudget(
      id,
      { ...baseInput, name: "Mars v2", lines: [{ plannedAmount: 500 }] },
      { id: owner },
    );
    const row = await db.budget.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    expect(row.name).toBe("Mars v2");
    expect(row.lines).toHaveLength(1);
    expect(Number(row.lines[0].plannedAmount)).toBe(500);
  });

  it("forbids updating/deleting a budget the actor does not own", async () => {
    const { id } = await createBudget(baseInput, { id: owner });
    await expect(updateBudget(id, baseInput, { id: stranger })).rejects.toBeInstanceOf(
      BudgetAccessError,
    );
    await expect(deleteBudget(id, { id: stranger })).rejects.toBeInstanceOf(BudgetAccessError);
    await deleteBudget(id, { id: owner });
    expect(await db.budget.findUnique({ where: { id } })).toBeNull();
  });
});

describe("getBudgetDetail / computeLine", () => {
  beforeEach(async () => {
    await db.budgetAssignment.deleteMany({});
    await db.transactionLinkMember.deleteMany({});
    await db.transactionLink.deleteMany({});
    await db.transaction.deleteMany({ where: { accountId } });
  });

  it("sums matching expenses per line (category filter), link-aware, with status", async () => {
    await tx("2026-03-03T00:00:00.000Z", -40, catId);
    await tx("2026-03-10T00:00:00.000Z", -80, catId);
    await tx("2026-03-12T00:00:00.000Z", -20, null); // no category → not matched
    const { id } = await createBudget(
      { ...baseInput, lines: [{ categoryId: catId, plannedAmount: 100 }] },
      { id: owner },
    );
    const detail = await getBudgetDetail(id, owner);
    expect(detail.lines[0].spent).toBe(120); // 40 + 80
    expect(detail.lines[0].status).toBe("OVER");
  });

  it("EXCLUDE removes a matching tx; INCLUDE adds a non-matching one", async () => {
    const a = await tx("2026-03-03T00:00:00.000Z", -40, catId); // matches, will EXCLUDE
    await tx("2026-03-05T00:00:00.000Z", -30, catId); // matches, stays
    const c = await tx("2026-03-06T00:00:00.000Z", -25, null); // no cat, will INCLUDE
    const { id } = await createBudget(
      { ...baseInput, lines: [{ categoryId: catId, plannedAmount: 100 }] },
      { id: owner },
    );
    await db.budgetAssignment.create({
      data: { budgetId: id, transactionId: a, mode: "EXCLUDE", assignedById: owner },
    });
    await db.budgetAssignment.create({
      data: { budgetId: id, transactionId: c, mode: "INCLUDE", assignedById: owner },
    });
    const detail = await getBudgetDetail(id, owner);
    expect(detail.lines[0].spent).toBe(55); // 30 (kept) + 25 (included) − 40 (excluded)
  });

  it("excludes a balanced link and collapses an unbalanced one to its net", async () => {
    const e1 = await tx("2026-03-03T00:00:00.000Z", -50, catId);
    const r1 = await tx("2026-03-04T00:00:00.000Z", 50, catId); // balanced pair → 0
    const e2 = await tx("2026-03-10T00:00:00.000Z", -80, catId);
    const r2 = await tx("2026-03-11T00:00:00.000Z", 30, catId); // net −50
    await createLink({ transactionIds: [e1, r1], userId: owner });
    await createLink({ transactionIds: [e2, r2], userId: owner });
    const { id } = await createBudget(
      { ...baseInput, lines: [{ categoryId: catId, plannedAmount: 100 }] },
      { id: owner },
    );
    const detail = await getBudgetDetail(id, owner);
    expect(detail.lines[0].spent).toBe(50); // balanced dropped; unbalanced net 50
  });
});

describe("assignTransaction", () => {
  beforeEach(async () => {
    await db.budgetAssignment.deleteMany({});
    await db.transaction.deleteMany({ where: { accountId } });
  });

  it("INCLUDE makes a non-matching tx count toward the budget; unassign reverts it", async () => {
    const t = await tx("2026-03-06T00:00:00.000Z", -25, null); // no category
    const { id } = await createBudget(
      { ...baseInput, lines: [{ categoryId: catId, plannedAmount: 100 }] },
      { id: owner },
    );
    let detail = await getBudgetDetail(id, owner);
    expect(detail.lines[0].spent).toBe(0); // doesn't match the category

    await assignTransaction({ budgetId: id, transactionId: t, mode: "INCLUDE" }, { id: owner });
    detail = await getBudgetDetail(id, owner);
    expect(detail.lines[0].spent).toBe(25);

    await unassignTransaction({ budgetId: id, transactionId: t }, { id: owner });
    detail = await getBudgetDetail(id, owner);
    expect(detail.lines[0].spent).toBe(0);
  });

  it("re-assigning the same tx updates the mode (unique per budget+tx)", async () => {
    const t = await tx("2026-03-06T00:00:00.000Z", -40, catId);
    const { id } = await createBudget(
      { ...baseInput, lines: [{ categoryId: catId, plannedAmount: 100 }] },
      { id: owner },
    );
    await assignTransaction({ budgetId: id, transactionId: t, mode: "EXCLUDE" }, { id: owner });
    expect((await getBudgetDetail(id, owner)).lines[0].spent).toBe(0);
    await assignTransaction({ budgetId: id, transactionId: t, mode: "INCLUDE" }, { id: owner });
    expect((await getBudgetDetail(id, owner)).lines[0].spent).toBe(40);
    expect(await db.budgetAssignment.count({ where: { budgetId: id, transactionId: t } })).toBe(1);
  });

  it("rejects assigning a tx the actor cannot see, or to a budget they can't manage", async () => {
    const t = await tx("2026-03-06T00:00:00.000Z", -40, catId);
    const { id } = await createBudget(baseInput, { id: owner });
    await expect(
      assignTransaction({ budgetId: id, transactionId: t, mode: "INCLUDE" }, { id: stranger }),
    ).rejects.toBeInstanceOf(BudgetAccessError);
  });

  it("lists budgets the actor may assign to (own + group budgets they're a member of)", async () => {
    await createBudget(baseInput, { id: owner });
    const list = await listAssignableBudgets(owner);
    expect(list.length).toBeGreaterThanOrEqual(1);
  });
});
