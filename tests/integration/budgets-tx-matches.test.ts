import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/server/db";
import {
  archiveBudget,
  assignTransaction,
  createBudget,
  listBudgetMatchesForTx,
} from "@/server/services/budgets";
import type { BudgetInput } from "@/lib/schemas/budget";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { createLink } from "@/server/services/links";

const owner = "btxm_owner";
const member = "btxm_member";
const stranger = "btxm_stranger";
const users = [owner, member, stranger];
let courant: string;
let joint: string;
let strangerAccount: string;
let groupId: string;
const cat: Record<"salary" | "loisirs" | "musique" | "courses", string> = {
  salary: "",
  loisirs: "",
  musique: "",
  courses: "",
};

const march = { periodType: "MONTH" as const, periodStart: "2026-03-01", periodEnd: "2026-03-31" };

function input(over: Partial<BudgetInput> = {}): BudgetInput {
  return {
    name: "Perso",
    ...march,
    accountId: courant,
    lines: [{ categoryId: cat.courses, plannedAmount: 100 }],
    ...over,
  };
}

async function tx(
  accountId: string,
  date: string,
  amount: number,
  categoryId: string | null = null,
): Promise<string> {
  const s = buildSecureFields({ label: "T", rawLabel: "T" });
  const row = await db.transaction.create({
    data: {
      accountId,
      date: new Date(`${date}T12:00:00.000Z`),
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

async function matchesOf(txId: string, viewer = owner) {
  return (await listBudgetMatchesForTx(txId, viewer)).matches;
}

async function cleanData() {
  await db.budget.deleteMany({ where: { OR: [{ userId: { in: users } }, { groupId }] } });
  await db.transaction.deleteMany({ where: { account: { ownerId: { in: users } } } });
  await db.transactionLink.deleteMany({ where: { createdById: { in: users } } });
}

beforeAll(async () => {
  await db.budget.deleteMany({ where: { userId: { in: users } } });
  await db.group.deleteMany({ where: { createdById: owner } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  for (const id of users) await db.user.create({ data: { id, email: `${id}@bilan.local` } });
  const account = (ownerId: string, name: string) =>
    db.bankAccount.create({ data: { ownerId, name, type: "CHECKING" } }).then((a) => a.id);
  courant = await account(owner, "Courant");
  joint = await account(owner, "Joint");
  strangerAccount = await account(stranger, "Autre");
  groupId = (await db.group.create({ data: { name: "Foyer Btxm", createdById: owner } })).id;
  await db.groupMember.createMany({
    data: [
      { groupId, userId: owner, role: "OWNER" },
      { groupId, userId: member, role: "MEMBER" },
    ],
  });
  await db.accountShare.create({
    data: { accountId: joint, groupId, permission: "WRITE", createdById: owner },
  });
  const category = (name: string, parentId?: string) =>
    db.category.create({ data: { userId: owner, name, parentId } }).then((c) => c.id);
  cat.salary = await category("Salaire");
  cat.loisirs = await category("Loisirs");
  cat.musique = await category("Musique", cat.loisirs);
  cat.courses = await category("Courses");
});

beforeEach(cleanData);

afterAll(async () => {
  await cleanData();
  await db.group.deleteMany({ where: { id: groupId } });
  await db.category.deleteMany({ where: { userId: owner, parentId: { not: null } } });
  await db.category.deleteMany({ where: { userId: owner } });
  await db.bankAccount.deleteMany({ where: { ownerId: { in: users } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});

describe("listBudgetMatchesForTx", () => {
  const leisure = () =>
    input({
      lines: [
        { kind: "INCOME", categoryId: cat.salary, plannedAmount: 2000 },
        { categoryId: cat.loisirs, plannedAmount: 50 },
        { categoryId: cat.musique, plannedAmount: 30 },
      ],
    });

  it("reports the category line of an attached budget, with its name", async () => {
    const t = await tx(courant, "2026-03-05", -40, cat.loisirs);
    const { id } = await createBudget(leisure(), { id: owner });
    const { matches, names } = await listBudgetMatchesForTx(t, owner);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ budgetId: id, name: "Perso", outside: null, lineCount: 3 });
    expect(matches[0].lines.map((l) => l.categoryId)).toEqual([cat.loisirs]);
    expect(names[cat.loisirs]).toBe("Loisirs");
  });

  it("picks the most specific line between a parent and its child", async () => {
    const t = await tx(courant, "2026-03-05", -20, cat.musique);
    await createBudget(leisure(), { id: owner });
    const [m] = await matchesOf(t);
    expect(m.lines.map((l) => l.categoryId)).toEqual([cat.musique]);
  });

  it("reports out of budget and unplanned income when no line takes it", async () => {
    const stray = await tx(courant, "2026-03-06", -12);
    const topUp = await tx(courant, "2026-03-07", 300);
    await createBudget(leisure(), { id: owner });
    expect((await matchesOf(stray))[0]).toMatchObject({ outside: "out", lines: [] });
    expect((await matchesOf(topUp))[0]).toMatchObject({ outside: "unplanned", lines: [] });
  });

  it("hides an EXCLUDE'd transaction", async () => {
    const t = await tx(courant, "2026-03-05", -20, cat.musique);
    const { id } = await createBudget(leisure(), { id: owner });
    await assignTransaction({ budgetId: id, transactionId: t, mode: "EXCLUDE" }, { id: owner });
    expect(await matchesOf(t)).toEqual([]);
  });

  it("lists an INCLUDE'd transaction on an unattached budget, even out of its period", async () => {
    const matching = await tx(courant, "2026-03-05", -30, cat.courses);
    const other = await tx(courant, "2026-04-02", -15);
    const { id } = await createBudget(input({ accountId: undefined }), { id: owner });
    expect((await matchesOf(matching))[0].lines.map((l) => l.categoryId)).toEqual([cat.courses]);
    expect(await matchesOf(other)).toEqual([]);
    await assignTransaction({ budgetId: id, transactionId: other, mode: "INCLUDE" }, { id: owner });
    expect((await matchesOf(other))[0]).toMatchObject({ budgetId: id, outside: "out", lines: [] });
  });

  it("counts a linked transfer on the transfer line, not on the other leg's account", async () => {
    const out = await tx(courant, "2026-03-02", -800);
    const into = await tx(joint, "2026-03-02", 800);
    await createLink({ transactionIds: [out, into], userId: owner });
    await createBudget(
      input({
        lines: [
          { kind: "TRANSFER", direction: "OUT", counterpartAccountId: joint, plannedAmount: 800 },
        ],
      }),
      { id: owner },
    );
    const { matches, names } = await listBudgetMatchesForTx(out, owner);
    expect(matches[0].lines).toMatchObject([
      { kind: "TRANSFER", direction: "OUT", counterpartAccountId: joint },
    ]);
    expect(names[joint]).toBe("Joint");
    expect(await matchesOf(into)).toEqual([]);
  });

  it("reports a collapsed link member under its primary's line", async () => {
    const expense = await tx(courant, "2026-03-05", -50, cat.courses);
    const refund = await tx(courant, "2026-03-09", 20);
    await createLink({ transactionIds: [expense, refund], userId: owner });
    await createBudget(input({ accountId: undefined }), { id: owner });
    const [m] = await matchesOf(refund);
    expect(m.lines.map((l) => l.categoryId)).toEqual([cat.courses]);
  });

  it("only lists non-archived budgets the viewer reads", async () => {
    const t = await tx(joint, "2026-03-05", -30, cat.courses);
    const personal = await createBudget(input({ accountId: undefined }), { id: owner });
    const shared = await createBudget(input({ name: "Foyer", groupId, accountId: joint }), {
      id: owner,
    });
    const own = await db.category.create({ data: { userId: stranger, name: "Courses" } });
    try {
      await createBudget(
        input({
          accountId: strangerAccount,
          lines: [{ categoryId: own.id, plannedAmount: 10 }],
        }),
        { id: stranger },
      );
      expect((await matchesOf(t)).map((m) => m.budgetId).sort()).toEqual(
        [personal.id, shared.id].sort(),
      );
      expect((await matchesOf(t, member)).map((m) => m.budgetId)).toEqual([shared.id]);
      expect(await matchesOf(t, stranger)).toEqual([]);
      await archiveBudget(shared.id, { id: owner });
      expect(await matchesOf(t, member)).toEqual([]);
    } finally {
      await db.budget.deleteMany({ where: { userId: stranger } });
      await db.category.delete({ where: { id: own.id } });
    }
  });
});
