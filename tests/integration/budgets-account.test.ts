import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/server/db";
import {
  archiveBudget,
  createBudget,
  getBudgetDetail,
  listBudgetsForUser,
  rollRecurring,
  rollRecurringBudgets,
  unarchiveBudget,
  updateBudget,
} from "@/server/services/budgets";
import type { BudgetInput } from "@/lib/schemas/budget";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { createLink } from "@/server/services/links";

const owner = "bacc_owner";
const member = "bacc_member";
const stranger = "bacc_stranger";
const users = [owner, member, stranger];
let courant: string;
let joint: string;
let livret: string;
let strangerAccount: string;
let groupId: string;
const cat: Record<"salary" | "loisirs" | "musique" | "livrets" | "courses", string> = {
  salary: "",
  loisirs: "",
  musique: "",
  livrets: "",
  courses: "",
};

const march = { periodType: "MONTH" as const, periodStart: "2026-03-01", periodEnd: "2026-03-31" };
const april = { periodType: "MONTH" as const, periodStart: "2026-04-01", periodEnd: "2026-04-30" };

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
  const account = (ownerId: string, name: string, type: string, initialBalance = 0) =>
    db.bankAccount.create({ data: { ownerId, name, type, initialBalance } }).then((a) => a.id);
  courant = await account(owner, "Courant", "CHECKING", 1000);
  joint = await account(owner, "Joint", "CHECKING");
  livret = await account(owner, "Livret", "SAVINGS");
  strangerAccount = await account(stranger, "Autre", "CHECKING");
  groupId = (await db.group.create({ data: { name: "Foyer Bacc", createdById: owner } })).id;
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
  cat.livrets = await category("Livrets");
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

describe("attaching a budget to an account", () => {
  it("attaches a personal budget to one of the owner's accounts", async () => {
    const { id } = await createBudget(input(), { id: owner });
    expect((await db.budget.findUniqueOrThrow({ where: { id } })).accountId).toBe(courant);
    const item = (await listBudgetsForUser(owner)).find((b) => b.id === id);
    expect(item?.accountId).toBe(courant);
  });

  it("refuses an account outside the budget's scope", async () => {
    await expect(
      createBudget(input({ accountId: strangerAccount }), { id: owner }),
    ).rejects.toThrow("INVALID_ACCOUNT");
    await expect(createBudget(input({ groupId }), { id: owner })).rejects.toThrow(
      "INVALID_ACCOUNT",
    );
    await expect(
      createBudget(input({ groupId, accountId: joint }), { id: owner }),
    ).resolves.toBeDefined();
  });

  it("refuses overlapping attached budgets on one account", async () => {
    const { id } = await createBudget(input(), { id: owner });
    await expect(
      createBudget(
        input({ periodType: "CUSTOM", periodStart: "2026-03-15", periodEnd: "2026-04-14" }),
        { id: owner },
      ),
    ).rejects.toThrow("ACCOUNT_OVERLAP");
    await expect(createBudget(input(april), { id: owner })).resolves.toBeDefined();
    await expect(createBudget(input({ accountId: livret }), { id: owner })).resolves.toBeDefined();
    await expect(updateBudget(id, input({ name: "Renamed" }), { id: owner })).resolves.toBe(
      undefined,
    );
    await archiveBudget(id, { id: owner });
    const { id: other } = await createBudget(input(), { id: owner });
    expect(other).toBeDefined();
    await expect(unarchiveBudget(id, { id: owner })).rejects.toThrow("ACCOUNT_OVERLAP");
  });

  it("stores attached lines without a line account filter, with kinds, counterparts and margin", async () => {
    const { id } = await createBudget(
      input({
        outOfBudgetPlanned: 50,
        lines: [
          { categoryId: cat.courses, accountId: courant, plannedAmount: 100 },
          { kind: "INCOME", categoryId: cat.salary, plannedAmount: 2000 },
          { kind: "TRANSFER", direction: "OUT", counterpartAccountId: livret, plannedAmount: 300 },
        ],
      }),
      { id: owner },
    );
    const row = await db.budget.findUniqueOrThrow({
      where: { id },
      include: { lines: { orderBy: { plannedAmount: "asc" } } },
    });
    expect(Number(row.outOfBudgetPlanned)).toBe(50);
    expect(
      row.lines.map((l) => [l.kind, l.accountId, l.direction, l.counterpartAccountId]),
    ).toEqual([
      ["EXPENSE", null, null, null],
      ["TRANSFER", null, "OUT", livret],
      ["INCOME", null, null, null],
    ]);
  });

  it("refuses a transfer counterpart outside the scope", async () => {
    await expect(
      createBudget(
        input({
          lines: [
            {
              kind: "TRANSFER",
              direction: "OUT",
              counterpartAccountId: strangerAccount,
              plannedAmount: 10,
            },
          ],
        }),
        { id: owner },
      ),
    ).rejects.toThrow("INVALID_LINE");
  });

  it("renewing copies account, kinds and margin", async () => {
    const lines: BudgetInput["lines"] = [
      { kind: "INCOME", categoryId: cat.salary, plannedAmount: 2000 },
      { kind: "TRANSFER", direction: "OUT", counterpartAccountId: livret, plannedAmount: 300 },
    ];
    const { id } = await createBudget(input({ recurring: true, outOfBudgetPlanned: 40, lines }), {
      id: owner,
    });
    const { id: next } = await rollRecurring(id, { id: owner });
    const { id: series2 } = await createBudget(
      input({ accountId: livret, recurring: true, lines: [lines[0]] }),
      { id: owner },
    );
    await rollRecurringBudgets(new Date("2026-04-02T00:00:00.000Z"));
    const rolled = await db.budget.findMany({
      where: { OR: [{ id: next }, { parentBudgetId: series2 }] },
      include: { lines: { orderBy: { plannedAmount: "desc" } } },
    });
    expect(rolled).toHaveLength(2);
    const manual = rolled.find((b) => b.id === next)!;
    expect(manual.accountId).toBe(courant);
    expect(Number(manual.outOfBudgetPlanned)).toBe(40);
    expect(manual.lines.map((l) => [l.kind, l.direction, l.counterpartAccountId])).toEqual([
      ["INCOME", null, null],
      ["TRANSFER", "OUT", livret],
    ]);
    const cron = rolled.find((b) => b.id !== next)!;
    expect(cron.accountId).toBe(livret);
    expect(cron.lines.map((l) => l.kind)).toEqual(["INCOME"]);
  });

  it("renewing into an overlap is refused by hand and skipped by the cron", async () => {
    const { id } = await createBudget(input({ recurring: true }), { id: owner });
    await createBudget(input({ ...april, name: "Avril" }), { id: owner });
    await expect(rollRecurring(id, { id: owner })).rejects.toThrow("ACCOUNT_OVERLAP");
    await rollRecurringBudgets(new Date("2026-04-02T00:00:00.000Z"));
    expect(await db.budget.count({ where: { parentBudgetId: id } })).toBe(0);
  });
});

describe("an attached budget's scope", () => {
  async function livretsTransfer() {
    const out = await tx(courant, "2026-03-10", -300, cat.livrets);
    const into = await tx(livret, "2026-03-10", 300, cat.livrets);
    await createLink({ transactionIds: [out, into], userId: owner });
    await tx(courant, "2026-03-12", -25, cat.livrets);
  }
  const livretsLine = () => [{ categoryId: cat.livrets, plannedAmount: 400 }];

  it("keeps a transfer leg linked to another account", async () => {
    await livretsTransfer();
    const { id } = await createBudget(input({ lines: livretsLine() }), { id: owner });
    const detail = await getBudgetDetail(id, owner);
    expect(detail.accountId).toBe(courant);
    expect(detail.lines[0].spent).toBe(325);
    expect(detail.spentTotal).toBe(325);
  });

  it("an unattached budget still nets the same transfer to zero", async () => {
    await livretsTransfer();
    const { id } = await createBudget(input({ accountId: undefined, lines: livretsLine() }), {
      id: owner,
    });
    expect((await getBudgetDetail(id, owner)).lines[0].spent).toBe(25);
  });

  it("an attached group budget counts nothing once its account is unshared", async () => {
    await tx(joint, "2026-03-05", -50, cat.courses);
    const { id } = await createBudget(input({ groupId, accountId: joint }), { id: owner });
    expect((await getBudgetDetail(id, owner)).spentTotal).toBe(50);
    await db.accountShare.deleteMany({ where: { accountId: joint, groupId } });
    try {
      expect((await getBudgetDetail(id, owner)).spentTotal).toBe(0);
    } finally {
      await db.accountShare.create({
        data: { accountId: joint, groupId, permission: "WRITE", createdById: owner },
      });
    }
  });

  it("an unattached budget ignores income and transfer lines", async () => {
    await tx(courant, "2026-03-05", -40, null);
    const { id } = await createBudget(
      input({
        lines: [
          { categoryId: cat.courses, plannedAmount: 100 },
          { kind: "TRANSFER", direction: "OUT", counterpartAccountId: livret, plannedAmount: 10 },
        ],
      }),
      { id: owner },
    );
    await db.budget.update({ where: { id }, data: { accountId: null } });
    const detail = await getBudgetDetail(id, owner);
    expect(detail.lines.map((l) => l.spent)).toEqual([0, 0]);
    expect(detail.spentTotal).toBe(0);
  });
});

describe("an attached budget by line kind", () => {
  async function link(a: string, b: string) {
    await createLink({ transactionIds: [a, b], userId: owner });
  }

  // Salary in, a transfer to the joint account, music, an unplanned expense and a top-up
  // taken from the savings account.
  async function envelope(over: Partial<BudgetInput> = {}) {
    await tx(courant, "2026-03-01", 2000, cat.salary);
    await link(await tx(courant, "2026-03-02", -800), await tx(joint, "2026-03-02", 800));
    await tx(courant, "2026-03-05", -20, cat.musique);
    const stray = await tx(courant, "2026-03-06", -12);
    const fromSavings = await tx(courant, "2026-03-07", 300);
    await link(fromSavings, await tx(livret, "2026-03-07", -300));
    const { id } = await createBudget(
      input({
        outOfBudgetPlanned: 100,
        lines: [
          { kind: "INCOME", categoryId: cat.salary, plannedAmount: 2000 },
          { kind: "TRANSFER", direction: "OUT", counterpartAccountId: joint, plannedAmount: 800 },
          { categoryId: cat.musique, plannedAmount: 30 },
        ],
        ...over,
      }),
      { id: owner },
    );
    return { id, stray, fromSavings };
  }

  it("splits spending and income by kind", async () => {
    const { id } = await envelope();
    const d = await getBudgetDetail(id, owner);
    expect(d.lines.map((l) => l.spent)).toEqual([2000, 800, 20]);
    expect(d.lines.map((l) => l.kind)).toEqual(["INCOME", "TRANSFER", "EXPENSE"]);
    expect(d.outOfBudget).toEqual({ spent: 12, count: 1, planned: 100, unmatchedTransfers: 0 });
    expect(d.unplannedIncome).toEqual({ received: 300, count: 1, fromSavings: 300 });
    expect(d.plannedTotal).toBe(930);
    expect(d.spentTotal).toBe(832);
    expect(d.incomePlanned).toBe(2000);
    expect(d.incomeReceived).toBe(2000);
    expect(d.transactionCount).toBe(5);
  });

  it("flags an unlinked leg with a same-amount row on another account", async () => {
    await tx(courant, "2026-03-10", -50);
    await tx(livret, "2026-03-12", 50);
    const { id } = await createBudget(input(), { id: owner });
    expect((await getBudgetDetail(id, owner)).outOfBudget?.unmatchedTransfers).toBe(1);
    await updateBudget(
      id,
      input({
        lines: [
          { categoryId: cat.courses, plannedAmount: 100 },
          { kind: "TRANSFER", direction: "OUT", counterpartAccountId: livret, plannedAmount: 100 },
        ],
      }),
      { id: owner },
    );
    const d = await getBudgetDetail(id, owner);
    expect(d.lines[1].spent).toBe(50);
    expect(d.outOfBudget).toMatchObject({ count: 0, unmatchedTransfers: 0 });
  });

  it("shows a transfer line as a read-only mirror in the destination budget", async () => {
    const { id: source } = await envelope();
    const { id } = await createBudget(input({ groupId, accountId: joint, name: "Foyer" }), {
      id: owner,
    });
    const d = await getBudgetDetail(id, owner);
    const mirror = d.lines.find((l) => l.mirrorOf);
    expect(mirror).toMatchObject({
      kind: "TRANSFER",
      direction: "IN",
      counterpartAccountId: courant,
      plannedAmount: 800,
      spent: 800,
      mirrorOf: { budgetId: source, budgetName: "Perso" },
    });
    expect(d.incomePlanned).toBe(800);
    expect(d.incomeReceived).toBe(800);
    const listed = (await listBudgetsForUser(owner)).find((b) => b.id === id);
    expect(listed?.incomePlanned).toBe(800);
  });

  it("shows no mirror across period types, to a viewer who can't read the source, or next to an own line", async () => {
    await envelope();
    const quarter = await createBudget(
      input({ accountId: joint, periodType: "QUARTER", periodEnd: "2026-05-31" }),
      { id: owner },
    );
    expect((await getBudgetDetail(quarter.id, owner)).lines.some((l) => l.mirrorOf)).toBe(false);
    await db.budget.delete({ where: { id: quarter.id } });

    const shared = await createBudget(input({ groupId, accountId: joint }), { id: owner });
    expect((await getBudgetDetail(shared.id, member)).lines.some((l) => l.mirrorOf)).toBe(false);
    await db.budget.delete({ where: { id: shared.id } });

    const own = await createBudget(
      input({
        accountId: joint,
        lines: [
          { kind: "TRANSFER", direction: "IN", counterpartAccountId: courant, plannedAmount: 700 },
        ],
      }),
      { id: owner },
    );
    const lines = (await getBudgetDetail(own.id, owner)).lines.filter(
      (l) => l.counterpartAccountId === courant,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ mirrorOf: null, plannedAmount: 700, spent: 800 });
  });

  it("doesn't turn the budget over when more than planned goes to savings", async () => {
    await link(await tx(courant, "2026-03-03", -150), await tx(livret, "2026-03-03", 150));
    const { id } = await createBudget(
      input({
        lines: [
          { kind: "TRANSFER", direction: "OUT", counterpartAccountId: livret, plannedAmount: 100 },
        ],
      }),
      { id: owner },
    );
    const d = await getBudgetDetail(id, owner);
    expect(d.spentTotal).toBe(150);
    expect(d.lines[0].counterpartSavings).toBe(true);
    expect((await listBudgetsForUser(owner)).find((b) => b.id === id)?.status).not.toBe("OVER");
  });

  it("lists only out-of-budget or unplanned rows on demand", async () => {
    const { id, stray, fromSavings } = await envelope();
    const out = await getBudgetDetail(id, owner, { show: "out" });
    expect(out.transactions.map((t) => t.id)).toEqual([stray]);
    expect(out.transactionCount).toBe(1);
    const unplanned = await getBudgetDetail(id, owner, { show: "unplanned" });
    expect(unplanned.transactions.map((t) => t.id)).toEqual([fromSavings]);
  });

  it("reports the same totals in the list as in the detail", async () => {
    const { id } = await envelope();
    const d = await getBudgetDetail(id, owner);
    const item = (await listBudgetsForUser(owner)).find((b) => b.id === id)!;
    expect({
      plannedTotal: item.plannedTotal,
      spentTotal: item.spentTotal,
      incomePlanned: item.incomePlanned,
      incomeReceived: item.incomeReceived,
      unplannedIncome: item.unplannedIncome,
    }).toEqual({
      plannedTotal: d.plannedTotal,
      spentTotal: d.spentTotal,
      incomePlanned: d.incomePlanned,
      incomeReceived: d.incomeReceived,
      unplannedIncome: d.unplannedIncome,
    });
  });
});
