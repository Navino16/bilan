import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { db } from "@/server/db";
import {
  createBudget,
  updateBudget,
  deleteBudget,
  archiveBudget,
  unarchiveBudget,
  listBudgetsForUser,
  getBudgetDetail,
  assignTransaction,
  unassignTransaction,
  listAssignableBudgets,
  listAssignmentsForTx,
  rollRecurring,
  rollRecurringBudgets,
  getCurrentBudget,
  listRollableTemplates,
  BudgetAccessError,
} from "@/server/services/budgets";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { createLink } from "@/server/services/links";
import { canReadAccount } from "@/server/services/accounts/sharing";

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

  it("rejects dates that don't match a typed period", async () => {
    await expect(
      createBudget(
        { ...baseInput, periodType: "YEAR", periodStart: "2025-12-01", periodEnd: "2026-01-31" },
        { id: owner },
      ),
    ).rejects.toMatchObject({ message: "PERIOD_MISMATCH" });
    await expect(
      createBudget(
        { ...baseInput, periodType: "CUSTOM", periodStart: "2025-12-01", periodEnd: "2026-01-31" },
        { id: owner },
      ),
    ).resolves.toHaveProperty("id");
  });

  it("rejects a line on another user's category or on an account outside the budget scope", async () => {
    const foreignCat = await db.category.create({ data: { userId: stranger, name: "Privée" } });
    await expect(
      createBudget(
        { ...baseInput, lines: [{ categoryId: foreignCat.id, plannedAmount: 10 }] },
        { id: owner },
      ),
    ).rejects.toMatchObject({ message: "INVALID_LINE" });
    // The owner's personal account isn't shared with the group.
    await expect(
      createBudget(
        { ...baseInput, groupId, lines: [{ accountId, plannedAmount: 10 }] },
        { id: owner },
      ),
    ).rejects.toMatchObject({ message: "INVALID_LINE" });
    await db.category.delete({ where: { id: foreignCat.id } });

    // A category of another household the owner belongs to doesn't fit this group budget.
    const other = await db.group.create({ data: { name: "Autre foyer", createdById: owner } });
    await db.groupMember.create({ data: { groupId: other.id, userId: owner, role: "OWNER" } });
    const otherCat = await db.category.create({ data: { groupId: other.id, name: "Ailleurs" } });
    await expect(
      createBudget(
        { ...baseInput, groupId, lines: [{ categoryId: otherCat.id, plannedAmount: 10 }] },
        { id: owner },
      ),
    ).rejects.toMatchObject({ message: "INVALID_LINE" });
    await db.group.delete({ where: { id: other.id } });
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

  it("a parent-category line counts its sub-categories, unless a more specific line exists", async () => {
    const child = await db.category.create({
      data: { userId: owner, name: "Drive", parentId: catId },
    });
    const grandChild = await db.category.create({
      data: { userId: owner, name: "Drive bio", parentId: child.id },
    });
    await tx("2026-03-03T00:00:00.000Z", -40, catId);
    await tx("2026-03-04T00:00:00.000Z", -25, child.id);
    await tx("2026-03-05T00:00:00.000Z", -10, grandChild.id);
    const { id } = await createBudget(
      {
        ...baseInput,
        lines: [
          { categoryId: catId, plannedAmount: 100 },
          { categoryId: child.id, plannedAmount: 50 },
        ],
      },
      { id: owner },
    );
    const detail = await getBudgetDetail(id, owner);
    expect(detail.lines.map((l) => l.spent)).toEqual([40, 35]);
    expect(detail.spentTotal).toBe(75);
    const listed = (await listBudgetsForUser(owner)).find((b) => b.id === id)!;
    expect(listed.spentTotal).toBe(75);
    await db.transaction.deleteMany({ where: { accountId } });
    await db.category.deleteMany({ where: { id: { in: [grandChild.id, child.id] } } });
  });

  it("a catch-all line takes the expenses no other line matches, never income", async () => {
    await tx("2026-03-03T00:00:00.000Z", -40, catId);
    await tx("2026-03-04T00:00:00.000Z", -15, null);
    await tx("2026-03-05T00:00:00.000Z", 2000, null); // income → ignored
    const { id } = await createBudget(
      {
        ...baseInput,
        lines: [
          { categoryId: catId, plannedAmount: 100 },
          { plannedAmount: 500 },
          { accountId, plannedAmount: 900 },
        ],
      },
      { id: owner },
    );
    const detail = await getBudgetDetail(id, owner);
    // The account line takes both expenses and no income; the catch-all only what no line matched.
    expect(detail.lines.map((l) => l.spent)).toEqual([40, 0, 55]);
    expect(detail.spentTotal).toBe(55);

    const alone = await createBudget(
      { ...baseInput, lines: [{ plannedAmount: 500 }] },
      { id: owner },
    );
    expect((await getBudgetDetail(alone.id, owner)).lines[0].spent).toBe(55);
  });

  it("lists the counted transactions, newest first, with their decrypted label", async () => {
    await tx("2026-03-03T00:00:00.000Z", -40, catId);
    await tx("2026-03-10T00:00:00.000Z", -80, catId);
    await tx("2026-03-12T00:00:00.000Z", -20, null); // not counted
    const { id } = await createBudget(
      { ...baseInput, lines: [{ categoryId: catId, plannedAmount: 100 }] },
      { id: owner },
    );
    const detail = await getBudgetDetail(id, owner);
    expect(detail.transactionCount).toBe(2);
    expect(detail.transactions.map((t) => [t.amount, t.label, t.accountName])).toEqual([
      [-80, "T", "Courant"],
      [-40, "T", "Courant"],
    ]);
  });

  it("shows every member a private transaction included in a household budget (spec §2.2)", async () => {
    await db.groupMember.create({ data: { groupId, userId: stranger, role: "MEMBER" } });
    const privateAccount = await db.bankAccount.create({
      data: { ownerId: stranger, name: "Privé", type: "CHECKING" },
    });
    const strangerCat = await db.category.create({ data: { userId: stranger, name: "Perso" } });
    const privateTx = async (label: string, day: string) => {
      const s = buildSecureFields({ label, rawLabel: label });
      return db.transaction.create({
        data: {
          accountId: privateAccount.id,
          date: new Date(`2026-03-${day}T00:00:00.000Z`),
          amount: -12,
          type: "OTHER",
          labelEnc: s.labelEnc,
          labelHash: s.labelHash,
          rawLabelEnc: s.rawLabelEnc,
          rawLabelHash: s.rawLabelHash,
          categoryId: strangerCat.id,
          createdById: stranger,
        },
      });
    };
    const included = await privateTx("Cinéma", "05");
    const unrelated = await privateTx("Secret", "06");
    try {
      const { id } = await createBudget(
        { ...baseInput, groupId, lines: [{ categoryId: catId, plannedAmount: 100 }] },
        { id: owner },
      );
      await assignTransaction(
        { budgetId: id, transactionId: included.id, mode: "INCLUDE" },
        { id: stranger },
      );
      const detail = await getBudgetDetail(id, owner);
      expect(detail.transactions).toEqual([
        {
          id: included.id,
          date: included.date,
          periodDate: included.date,
          amount: -12,
          label: "Cinéma",
          categoryId: strangerCat.id,
          accountName: "Privé",
        },
      ]);
      expect(detail.transactionCount).toBe(1);
      expect(await canReadAccount(owner, privateAccount.id)).toBe(false);
      expect(JSON.stringify(detail)).not.toContain(unrelated.id);
    } finally {
      await db.budgetAssignment.deleteMany({ where: { transactionId: included.id } });
      await db.transaction.deleteMany({ where: { accountId: privateAccount.id } });
      await db.bankAccount.delete({ where: { id: privateAccount.id } });
      await db.category.delete({ where: { id: strangerCat.id } });
      await db.groupMember.deleteMany({ where: { groupId, userId: stranger } });
    }
  });

  describe("re-checks visibility of included transactions when displayed", () => {
    let strangerAccount: string;

    async function strangerTx(): Promise<{ id: string; date: Date }> {
      const s = buildSecureFields({ label: "Cinéma", rawLabel: "Cinéma" });
      return db.transaction.create({
        data: {
          accountId: strangerAccount,
          date: new Date("2026-03-05T00:00:00.000Z"),
          amount: -12,
          type: "OTHER",
          labelEnc: s.labelEnc,
          labelHash: s.labelHash,
          rawLabelEnc: s.rawLabelEnc,
          rawLabelHash: s.rawLabelHash,
          createdById: stranger,
        },
        select: { id: true, date: true },
      });
    }

    const masked = (date: Date) => ({
      id: "hidden-0",
      date,
      periodDate: date,
      amount: -12,
      label: null,
      categoryId: null,
      accountName: null,
    });

    beforeEach(async () => {
      strangerAccount = (
        await db.bankAccount.create({
          data: { ownerId: stranger, name: "Privé", type: "CHECKING" },
        })
      ).id;
      await db.groupMember.create({ data: { groupId, userId: stranger, role: "MEMBER" } });
    });

    afterEach(async () => {
      await db.budgetAssignment.deleteMany({
        where: { transaction: { accountId: strangerAccount } },
      });
      await db.transaction.deleteMany({ where: { accountId: strangerAccount } });
      await db.accountShare.deleteMany({ where: { accountId: strangerAccount } });
      await db.bankAccount.delete({ where: { id: strangerAccount } });
      await db.groupMember.deleteMany({ where: { groupId, userId: stranger } });
    });

    it("masks a private transaction once its owner left the household, still counting it", async () => {
      const t = await strangerTx();
      const { id } = await createBudget(
        { ...baseInput, groupId, lines: [{ categoryId: catId, plannedAmount: 100 }] },
        { id: owner },
      );
      await assignTransaction(
        { budgetId: id, transactionId: t.id, mode: "INCLUDE" },
        { id: stranger },
      );
      await db.groupMember.deleteMany({ where: { groupId, userId: stranger } });

      const detail = await getBudgetDetail(id, owner);
      expect(detail.transactions).toEqual([masked(t.date)]);
      expect(detail.transactionCount).toBe(1);
      expect(detail.spentTotal).toBe(12);
      expect(JSON.stringify(detail)).not.toContain(t.id);
    });

    it("keeps showing a transaction of an account shared with the household after its owner left", async () => {
      await db.accountShare.create({
        data: { accountId: strangerAccount, groupId, permission: "READ", createdById: stranger },
      });
      const t = await strangerTx();
      const { id } = await createBudget(
        { ...baseInput, groupId, lines: [{ categoryId: catId, plannedAmount: 100 }] },
        { id: owner },
      );
      await assignTransaction(
        { budgetId: id, transactionId: t.id, mode: "INCLUDE" },
        { id: stranger },
      );
      await db.groupMember.deleteMany({ where: { groupId, userId: stranger } });

      const detail = await getBudgetDetail(id, owner);
      expect(detail.transactions).toEqual([
        {
          id: t.id,
          date: t.date,
          periodDate: t.date,
          amount: -12,
          label: "Cinéma",
          categoryId: null,
          accountName: "Privé",
        },
      ]);
    });

    it("masks an INCLUDE in a personal budget from an account its owner can no longer read", async () => {
      await db.accountShare.create({
        data: { accountId: strangerAccount, groupId, permission: "READ", createdById: stranger },
      });
      const t = await strangerTx();
      const { id } = await createBudget(
        { ...baseInput, lines: [{ categoryId: catId, plannedAmount: 100 }] },
        { id: owner },
      );
      await assignTransaction(
        { budgetId: id, transactionId: t.id, mode: "INCLUDE" },
        { id: owner },
      );
      expect((await getBudgetDetail(id, owner)).transactions[0].label).toBe("Cinéma");
      await db.accountShare.deleteMany({ where: { accountId: strangerAccount } });

      const detail = await getBudgetDetail(id, owner);
      expect(detail.transactions).toEqual([masked(t.date)]);
      expect(detail.transactionCount).toBe(1);
      expect(detail.spentTotal).toBe(12);
    });
  });

  it("picks the personal budget in progress for the dashboard", async () => {
    await createBudget({ ...baseInput, groupId, name: "Foyer" }, { id: owner });
    const { id } = await createBudget({ ...baseInput, name: "Perso" }, { id: owner });
    const current = await getCurrentBudget(owner, new Date("2026-03-15T12:00:00.000Z"));
    expect(current?.detail.id).toBe(id);
    expect(current?.others).toBe(1);
    expect(await getCurrentBudget(owner, new Date("2027-01-01T00:00:00.000Z"))).toBeNull();
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

  it("listBudgetsForUser reports the same spend and status as the detail", async () => {
    const a = await tx("2026-03-03T00:00:00.000Z", -40, catId); // matches, will EXCLUDE
    await tx("2026-03-05T00:00:00.000Z", -90, catId);
    const { id } = await createBudget(
      { ...baseInput, lines: [{ categoryId: catId, plannedAmount: 100 }] },
      { id: owner },
    );
    await db.budgetAssignment.create({
      data: { budgetId: id, transactionId: a, mode: "EXCLUDE", assignedById: owner },
    });
    const detail = await getBudgetDetail(id, owner);
    const item = (await listBudgetsForUser(owner)).find((b) => b.id === id);
    expect(item?.spentTotal).toBe(detail.spentTotal);
    expect(item).toMatchObject({ spentTotal: 90, percent: 90, status: "WARN" });
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

  it("INCLUDE into a group budget needs the account owned by the actor or shared with that group", async () => {
    const own = await tx("2026-03-06T00:00:00.000Z", -10, null);
    const other = await db.group.create({ data: { name: "Autre foyer", createdById: stranger } });
    await db.groupMember.createMany({
      data: [
        { groupId: other.id, userId: stranger, role: "OWNER" },
        { groupId: other.id, userId: owner, role: "MEMBER" },
      ],
    });
    const foreign = await db.bankAccount.create({
      data: { ownerId: stranger, name: "Commun", type: "CHECKING" },
    });
    await db.accountShare.create({
      data: {
        accountId: foreign.id,
        groupId: other.id,
        permission: "WRITE",
        createdById: stranger,
      },
    });
    const s = buildSecureFields({ label: "Autre", rawLabel: "Autre" });
    const foreignTx = await db.transaction.create({
      data: {
        accountId: foreign.id,
        date: new Date("2026-03-07T00:00:00.000Z"),
        amount: -20,
        type: "OTHER",
        labelEnc: s.labelEnc,
        labelHash: s.labelHash,
        rawLabelEnc: s.rawLabelEnc,
        rawLabelHash: s.rawLabelHash,
        createdById: stranger,
      },
    });
    try {
      const { id } = await createBudget({ ...baseInput, groupId }, { id: owner });
      await assignTransaction({ budgetId: id, transactionId: own, mode: "INCLUDE" }, { id: owner });

      expect(await canReadAccount(owner, foreign.id)).toBe(true);
      await expect(
        assignTransaction(
          { budgetId: id, transactionId: foreignTx.id, mode: "INCLUDE" },
          { id: owner },
        ),
      ).rejects.toThrow(new BudgetAccessError("FORBIDDEN"));
      expect(await db.budgetAssignment.count({ where: { transactionId: foreignTx.id } })).toBe(0);

      await db.accountShare.create({
        data: { accountId: foreign.id, groupId, permission: "READ", createdById: stranger },
      });
      await assignTransaction(
        { budgetId: id, transactionId: foreignTx.id, mode: "INCLUDE" },
        { id: owner },
      );
      expect(await db.budgetAssignment.count({ where: { budgetId: id } })).toBe(2);
    } finally {
      await db.budgetAssignment.deleteMany({ where: { transactionId: foreignTx.id } });
      await db.transaction.deleteMany({ where: { accountId: foreign.id } });
      await db.bankAccount.delete({ where: { id: foreign.id } });
      await db.groupMember.deleteMany({ where: { groupId: other.id } });
      await db.group.delete({ where: { id: other.id } });
    }
  });

  it("lists budgets the actor may assign to (own + group budgets they're a member of)", async () => {
    await createBudget(baseInput, { id: owner });
    const list = await listAssignableBudgets(owner);
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it("tells same-named budgets apart by group and period (#161)", async () => {
    await db.budget.deleteMany({ where: { OR: [{ userId: owner }, { groupId }] } });
    await createBudget({ ...baseInput, name: "Mensuel" }, { id: owner });
    await createBudget({ ...baseInput, name: "Mensuel", groupId }, { id: owner });
    const list = await listAssignableBudgets(owner);
    expect(list.map((b) => [b.name, b.groupName, b.periodStart.toISOString()])).toEqual(
      expect.arrayContaining([
        ["Mensuel", null, "2026-03-01T00:00:00.000Z"],
        ["Mensuel", "Foyer Bud", "2026-03-01T00:00:00.000Z"],
      ]),
    );
  });
});

describe("rollRecurring", () => {
  beforeEach(async () => {
    await db.budget.deleteMany({ where: { userId: owner } });
  });

  it("creates one next-period instance linked to the template, and is idempotent", async () => {
    const { id } = await createBudget(
      { ...baseInput, recurring: true, lines: [{ categoryId: catId, plannedAmount: 200 }] },
      { id: owner },
    );
    const first = await rollRecurring(id, { id: owner });
    expect(first.created).toBe(true);
    const instance = await db.budget.findUniqueOrThrow({
      where: { id: first.id! },
      include: { lines: true },
    });
    expect(instance.parentBudgetId).toBe(id);
    expect(instance.periodStart.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(instance.periodEnd.toISOString()).toBe("2026-04-30T23:59:59.999Z");
    expect(instance.lines).toHaveLength(1);
    expect(Number(instance.lines[0].plannedAmount)).toBe(200);

    // Idempotent: a second roll does not create a duplicate for the same next period.
    const second = await rollRecurring(id, { id: owner });
    expect(second.created).toBe(false);
    expect(
      await db.budget.count({ where: { parentBudgetId: id, periodStart: instance.periodStart } }),
    ).toBe(1);
  });

  it("lists an ended recurring budget as rollable until its next instance exists", async () => {
    const { id } = await createBudget({ ...baseInput, recurring: true }, { id: owner });
    const before = (await listBudgetsForUser(owner)).find((b) => b.id === id)!;
    expect(before.rollable).toBe(true);
    await rollRecurring(id, { id: owner });
    const after = (await listBudgetsForUser(owner)).find((b) => b.id === id)!;
    expect(after.rollable).toBe(false);
  });

  it("links neighbouring periods and keeps the series when its template is deleted", async () => {
    const { id } = await createBudget({ ...baseInput, recurring: true }, { id: owner });
    const april = (await rollRecurring(id, { id: owner })).id!;
    const may = (await rollRecurring(april, { id: owner })).id!;
    const mid = await getBudgetDetail(april, owner);
    expect([mid.previousId, mid.nextId]).toEqual([id, may]);
    expect(mid.canManage).toBe(true);

    await deleteBudget(id, { id: owner });
    const heir = await db.budget.findUniqueOrThrow({ where: { id: april } });
    expect(heir.parentBudgetId).toBeNull();
    expect((await db.budget.findUniqueOrThrow({ where: { id: may } })).parentBudgetId).toBe(april);
    expect((await getBudgetDetail(may, owner)).previousId).toBe(april);
  });

  it("doesn't recreate a deleted middle period", async () => {
    const { id } = await createBudget({ ...baseInput, recurring: true }, { id: owner });
    const april = (await rollRecurring(id, { id: owner })).id!;
    await rollRecurring(april, { id: owner });
    await deleteBudget(april, { id: owner });
    const rollable = await listRollableTemplates(new Date("2026-06-15T00:00:00.000Z"));
    expect(rollable.map((r) => r.id)).not.toContain(id);
    expect((await rollRecurring(id, { id: owner })).created).toBe(false);
  });

  it("rejects rolling a non-recurring budget", async () => {
    const { id } = await createBudget(baseInput, { id: owner });
    await expect(rollRecurring(id, { id: owner })).rejects.toBeInstanceOf(BudgetAccessError);
  });
});

describe("hardening (group scope, dedup, links, out-of-period, canManage)", () => {
  let sharedAccountId: string;
  let otherCatId: string;

  beforeAll(async () => {
    sharedAccountId = (
      await db.bankAccount.create({ data: { ownerId: owner, name: "Partagé", type: "CHECKING" } })
    ).id;
    await db.accountShare.create({
      data: { accountId: sharedAccountId, groupId, permission: "READ", createdById: owner },
    });
    otherCatId = (await db.category.create({ data: { userId: owner, name: "Autre" } })).id;
  });

  afterAll(async () => {
    await db.transaction.deleteMany({ where: { accountId: sharedAccountId } });
    await db.accountShare.deleteMany({ where: { accountId: sharedAccountId } });
    await db.bankAccount.deleteMany({ where: { id: sharedAccountId } });
    await db.category.deleteMany({ where: { id: otherCatId } });
  });

  beforeEach(async () => {
    await db.budgetAssignment.deleteMany({});
    await db.transactionLinkMember.deleteMany({});
    await db.transactionLink.deleteMany({});
    await db.transaction.deleteMany({ where: { accountId: { in: [accountId, sharedAccountId] } } });
  });

  async function txOn(
    account: string,
    date: string,
    amount: number,
    categoryId: string | null,
  ): Promise<string> {
    const s = buildSecureFields({ label: "T", rawLabel: "T" });
    const row = await db.transaction.create({
      data: {
        accountId: account,
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

  it("#1 group budget counts only the group's shared accounts, not a member's personal account", async () => {
    await txOn(sharedAccountId, "2026-03-05T00:00:00.000Z", -50, catId); // shared → counts
    await txOn(accountId, "2026-03-06T00:00:00.000Z", -30, catId); // personal (unshared) → must NOT count
    const { id } = await createBudget(
      { ...baseInput, groupId, lines: [{ categoryId: catId, plannedAmount: 200 }] },
      { id: owner },
    );
    const detail = await getBudgetDetail(id, owner);
    expect(detail.lines[0].spent).toBe(50);
    expect(detail.spentTotal).toBe(50);
  });

  it("#2 spentTotal counts a tx once and an INCLUDE with no matching line lands on the first line only", async () => {
    const t = await txOn(accountId, "2026-03-07T00:00:00.000Z", -50, null); // no category
    const { id } = await createBudget(
      {
        ...baseInput,
        lines: [
          { categoryId: catId, plannedAmount: 100 },
          { categoryId: otherCatId, plannedAmount: 100 },
        ],
      },
      { id: owner },
    );
    await assignTransaction({ budgetId: id, transactionId: t, mode: "INCLUDE" }, { id: owner });
    const detail = await getBudgetDetail(id, owner);
    expect(detail.lines[0].spent).toBe(50); // attributed to the first line
    expect(detail.lines[1].spent).toBe(0); // not double-counted onto the second line
    expect(detail.spentTotal).toBe(50); // counted once overall
  });

  it("#3 nets a link split across categories (offsetting member kept)", async () => {
    const e = await txOn(accountId, "2026-03-03T00:00:00.000Z", -100, catId);
    const r = await txOn(accountId, "2026-03-04T00:00:00.000Z", 30, otherCatId); // different category
    await createLink({ transactionIds: [e, r], userId: owner });
    const { id } = await createBudget(
      { ...baseInput, lines: [{ categoryId: catId, plannedAmount: 100 }] },
      { id: owner },
    );
    const detail = await getBudgetDetail(id, owner);
    expect(detail.lines[0].spent).toBe(70); // net −70, not −100
  });

  it("#4 an INCLUDE outside the budget period still counts", async () => {
    const t = await txOn(accountId, "2026-02-15T00:00:00.000Z", -25, null); // before March
    const { id } = await createBudget(
      { ...baseInput, lines: [{ categoryId: catId, plannedAmount: 100 }] },
      { id: owner },
    );
    await assignTransaction({ budgetId: id, transactionId: t, mode: "INCLUDE" }, { id: owner });
    const detail = await getBudgetDetail(id, owner);
    expect(detail.lines[0].spent).toBe(25);
  });

  it("#6 canManage is false for a non-admin group member, true for the owner", async () => {
    await createBudget({ ...baseInput, groupId }, { id: owner });
    // Add stranger as a plain MEMBER of the group.
    await db.groupMember.create({ data: { groupId, userId: stranger, role: "MEMBER" } });
    try {
      const asMember = (await listBudgetsForUser(stranger)).find((b) => b.groupId === groupId);
      expect(asMember?.canManage).toBe(false);
      const asOwner = (await listBudgetsForUser(owner)).find((b) => b.groupId === groupId);
      expect(asOwner?.canManage).toBe(true);
    } finally {
      await db.groupMember.deleteMany({ where: { groupId, userId: stranger } });
    }
  });
});

describe("archive / description / line labels", () => {
  it("keeps a description and per-line labels through create, update and detail", async () => {
    const { id } = await createBudget(
      {
        ...baseInput,
        description: "  Courses du mois  ",
        lines: [{ categoryId: catId, label: " Supermarché ", plannedAmount: 300 }],
      },
      { id: owner },
    );
    let detail = await getBudgetDetail(id, owner);
    expect(detail.description).toBe("Courses du mois");
    expect(detail.lines[0].label).toBe("Supermarché");
    expect((await listBudgetsForUser(owner)).find((b) => b.id === id)?.description).toBe(
      "Courses du mois",
    );

    await updateBudget(
      id,
      { ...baseInput, description: "", lines: [{ categoryId: catId, plannedAmount: 300 }] },
      { id: owner },
    );
    detail = await getBudgetDetail(id, owner);
    expect(detail.description).toBeNull();
    expect(detail.lines[0].label).toBeNull();
  });

  it("archived budgets leave the list, the assignable menu and the dashboard, and come back", async () => {
    const { id } = await createBudget(baseInput, { id: owner });
    await archiveBudget(id, { id: owner });

    expect((await listBudgetsForUser(owner)).map((b) => b.id)).not.toContain(id);
    const archived = await listBudgetsForUser(owner, { archived: true });
    expect(archived.map((b) => b.id)).toEqual([id]);
    expect(archived[0]).toMatchObject({ archived: true, canManage: true, rollable: false });
    expect((await listAssignableBudgets(owner)).map((b) => b.id)).not.toContain(id);
    expect(await getCurrentBudget(owner, new Date("2026-03-15T12:00:00.000Z"))).toBeNull();
    expect((await getBudgetDetail(id, owner)).archived).toBe(true);

    await unarchiveBudget(id, { id: owner });
    expect((await listBudgetsForUser(owner)).map((b) => b.id)).toContain(id);
    expect(await listBudgetsForUser(owner, { archived: true })).toEqual([]);
    expect((await getBudgetDetail(id, owner)).archived).toBe(false);
    const actions = await db.auditLog.findMany({
      where: { entityId: id, action: { in: ["budget.archived", "budget.unarchived"] } },
      select: { action: true },
    });
    expect(actions.map((a) => a.action).sort()).toEqual(["budget.archived", "budget.unarchived"]);
  });

  it("an archived recurring budget is not rolled", async () => {
    const { id } = await createBudget({ ...baseInput, recurring: true }, { id: owner });
    await archiveBudget(id, { id: owner });
    const rollable = await listRollableTemplates(new Date("2026-05-01T00:00:00.000Z"));
    expect(rollable.map((r) => r.id)).not.toContain(id);
  });

  it("an archived budget is never rolled, even by a direct call", async () => {
    const { id } = await createBudget({ ...baseInput, recurring: true }, { id: owner });
    await archiveBudget(id, { id: owner });
    expect(await rollRecurring(id, { id: owner })).toEqual({ created: false });
    await rollRecurringBudgets(new Date("2026-05-01T00:00:00.000Z"));
    expect(await db.budget.count({ where: { parentBudgetId: id } })).toBe(0);
  });

  it("keeps an assignment to an archived budget visible and removable, but takes no new one", async () => {
    await db.budgetAssignment.deleteMany({});
    const t = await tx("2026-03-06T00:00:00.000Z", -25, null);
    const { id } = await createBudget(baseInput, { id: owner });
    await assignTransaction({ budgetId: id, transactionId: t, mode: "INCLUDE" }, { id: owner });
    await archiveBudget(id, { id: owner });

    expect(await listAssignmentsForTx(t, owner)).toEqual([
      {
        budgetId: id,
        mode: "INCLUDE",
        budget: expect.objectContaining({ id, name: "Mars", archived: true, groupName: null }),
      },
    ]);
    await expect(
      assignTransaction({ budgetId: id, transactionId: t, mode: "EXCLUDE" }, { id: owner }),
    ).rejects.toThrow("ARCHIVED");

    await unassignTransaction({ budgetId: id, transactionId: t }, { id: owner });
    expect(await listAssignmentsForTx(t, owner)).toEqual([]);
  });

  it("lists only the assignments on budgets the viewer can read", async () => {
    await db.budgetAssignment.deleteMany({});
    const t = await tx("2026-03-06T00:00:00.000Z", -25, null);
    const shared = await createBudget({ ...baseInput, groupId }, { id: owner });
    await assignTransaction(
      { budgetId: shared.id, transactionId: t, mode: "EXCLUDE" },
      { id: owner },
    );
    expect((await listAssignmentsForTx(t, owner)).map((a) => a.budgetId)).toEqual([shared.id]);
    expect(await listAssignmentsForTx(t, stranger)).toEqual([]);
  });

  it("only a budget manager may archive or unarchive it", async () => {
    const own = await createBudget(baseInput, { id: owner });
    await expect(archiveBudget(own.id, { id: stranger })).rejects.toBeInstanceOf(BudgetAccessError);
    const shared = await createBudget({ ...baseInput, groupId }, { id: owner });
    await db.groupMember.create({ data: { groupId, userId: stranger, role: "MEMBER" } });
    try {
      await expect(archiveBudget(shared.id, { id: stranger })).rejects.toBeInstanceOf(
        BudgetAccessError,
      );
      await archiveBudget(shared.id, { id: owner });
      await expect(unarchiveBudget(shared.id, { id: stranger })).rejects.toBeInstanceOf(
        BudgetAccessError,
      );
      // A plain member still sees the household's archived budget, read-only.
      const seen = await listBudgetsForUser(stranger, { archived: true });
      expect(seen.find((b) => b.id === shared.id)?.canManage).toBe(false);
    } finally {
      await db.groupMember.deleteMany({ where: { groupId, userId: stranger } });
    }
  });
});
