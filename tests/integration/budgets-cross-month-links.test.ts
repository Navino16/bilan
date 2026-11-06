import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/server/db";
import {
  assignTransaction,
  createBudget,
  getBudgetDetail,
  listBudgetMatchesForTx,
  listBudgetsForUser,
  currentLandings,
  listCurrentBudgets,
} from "@/server/services/budgets";
import type { BudgetInput } from "@/lib/schemas/budget";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { createLink } from "@/server/services/links";

const owner = "bxml_owner";
const users = [owner];
let courant: string;
let joint: string;
const cat: Record<"salary" | "courses", string> = { salary: "", courses: "" };

const march = { periodType: "MONTH" as const, periodStart: "2026-03-01", periodEnd: "2026-03-31" };
const april = { periodType: "MONTH" as const, periodStart: "2026-04-01", periodEnd: "2026-04-30" };
const mayPeriod = {
  periodType: "MONTH" as const,
  periodStart: "2026-05-01",
  periodEnd: "2026-05-31",
};

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
      type: "TRANSFER",
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

async function link(...ids: string[]) {
  await createLink({ transactionIds: ids, userId: owner });
}

async function marchAndApril(over: Partial<BudgetInput> = {}) {
  const mar = await createBudget(input({ name: "Mars", ...over }), { id: owner });
  const apr = await createBudget(input({ name: "Avril", ...april, ...over }), { id: owner });
  return { mar: mar.id, apr: apr.id };
}

const matchesOf = async (txId: string) =>
  (await listBudgetMatchesForTx(txId, owner)).matches.map((m) => ({
    budgetId: m.budgetId,
    categoryIds: m.lines.map((l) => l.categoryId),
    outside: m.outside,
  }));

async function cleanData() {
  await db.budget.deleteMany({ where: { userId: { in: users } } });
  await db.transaction.deleteMany({ where: { account: { ownerId: { in: users } } } });
  await db.transactionLink.deleteMany({ where: { createdById: { in: users } } });
}

beforeAll(async () => {
  await db.budget.deleteMany({ where: { userId: { in: users } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  for (const id of users) await db.user.create({ data: { id, email: `${id}@bilan.local` } });
  const account = (name: string, initialBalance = 0) =>
    db.bankAccount
      .create({ data: { ownerId: owner, name, type: "CHECKING", initialBalance } })
      .then((a) => a.id);
  courant = await account("Courant", 1000);
  joint = await account("Joint");
  const category = (name: string) =>
    db.category.create({ data: { userId: owner, name } }).then((c) => c.id);
  cat.salary = await category("Salaire");
  cat.courses = await category("Courses");
});

beforeEach(cleanData);

afterAll(async () => {
  await cleanData();
  await db.category.deleteMany({ where: { userId: owner } });
  await db.bankAccount.deleteMany({ where: { ownerId: { in: users } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});

describe("cross-account links (current behaviour)", () => {
  it("an attached budget keeps its transfer leg whatever the other leg's month", async () => {
    const out = await tx(courant, "2026-03-31", -800);
    const into = await tx(joint, "2026-04-01", 800);
    await link(out, into);
    const { id: mar } = await createBudget(
      input({
        lines: [
          { kind: "TRANSFER", direction: "OUT", counterpartAccountId: joint, plannedAmount: 800 },
        ],
      }),
      { id: owner },
    );
    const { id: apr } = await createBudget(
      input({
        ...april,
        accountId: joint,
        lines: [
          { kind: "TRANSFER", direction: "IN", counterpartAccountId: courant, plannedAmount: 800 },
        ],
      }),
      { id: owner },
    );
    const m = await getBudgetDetail(mar, owner);
    expect(m.lines[0].spent).toBe(800);
    expect(m.outOfBudget?.count).toBe(0);
    const a = await getBudgetDetail(apr, owner);
    expect(a.lines[0].spent).toBe(800);
    expect(a.unplannedIncome?.count).toBe(0);
    expect(await matchesOf(out)).toEqual([{ budgetId: mar, categoryIds: [null], outside: null }]);
    expect(await matchesOf(into)).toEqual([{ budgetId: apr, categoryIds: [null], outside: null }]);
  });

  it("an unattached budget nets a same-month transfer between two of its accounts", async () => {
    const out = await tx(courant, "2026-03-10", -80, cat.courses);
    await link(out, await tx(joint, "2026-03-11", 80, cat.courses));
    const { id } = await createBudget(input({ accountId: undefined }), { id: owner });
    const d = await getBudgetDetail(id, owner);
    expect(d.lines[0].spent).toBe(0);
    expect(d.transactionCount).toBe(0);
    expect(await matchesOf(out)).toEqual([]);
  });

  it("an attached budget counts a same-month refund link to its net", async () => {
    const expense = await tx(courant, "2026-03-05", -50, cat.courses);
    const refund = await tx(courant, "2026-03-09", 20);
    await link(expense, refund);
    const { id } = await createBudget(input(), { id: owner });
    expect((await getBudgetDetail(id, owner)).lines[0].spent).toBe(30);
    expect(await matchesOf(refund)).toEqual([
      { budgetId: id, categoryIds: [cat.courses], outside: null },
    ]);
  });
});

describe("a link whose members fall in different months (#412)", () => {
  it("excludes a balanced same-account link from both attached budgets", async () => {
    const paid = await tx(courant, "2026-04-01", -187);
    const received = await tx(courant, "2026-03-31", 187, cat.salary);
    await link(paid, received);
    const { mar, apr } = await marchAndApril();
    const m = await getBudgetDetail(mar, owner);
    expect(m.unplannedIncome).toEqual({ received: 0, count: 0, fromSavings: 0 });
    expect(m.transactionCount).toBe(0);
    const a = await getBudgetDetail(apr, owner);
    expect(a.outOfBudget).toMatchObject({ spent: 0, count: 0 });
    expect(a.transactionCount).toBe(0);
    expect(await matchesOf(paid)).toEqual([]);
    expect(await matchesOf(received)).toEqual([]);
  });

  it("counts an unbalanced link's net once, in its primary's month and category", async () => {
    const paid = await tx(courant, "2026-04-01", -200, cat.courses);
    const received = await tx(courant, "2026-03-31", 187, cat.salary);
    await link(paid, received);
    const { mar, apr } = await marchAndApril();
    const m = await getBudgetDetail(mar, owner);
    expect(m.unplannedIncome?.count).toBe(0);
    expect(m.transactionCount).toBe(0);
    const a = await getBudgetDetail(apr, owner);
    expect(a.lines[0].spent).toBe(13);
    expect(a.transactions.map((t) => [t.id, t.amount])).toEqual([[paid, -13]]);
    const item = (await listBudgetsForUser(owner)).find((b) => b.id === apr)!;
    expect(item.spentTotal).toBe(a.spentTotal);
    const counted = [{ budgetId: apr, categoryIds: [cat.courses], outside: null }];
    expect(await matchesOf(paid)).toEqual(counted);
    expect(await matchesOf(received)).toEqual(counted);
  });

  it("counts the net in the earlier month when the primary falls there", async () => {
    const paid = await tx(courant, "2026-03-31", -200, cat.courses);
    await link(paid, await tx(courant, "2026-04-01", 187, cat.salary));
    const { mar, apr } = await marchAndApril();
    expect((await getBudgetDetail(mar, owner)).lines[0].spent).toBe(13);
    const a = await getBudgetDetail(apr, owner);
    expect(a.unplannedIncome?.count).toBe(0);
    expect(a.transactionCount).toBe(0);
  });

  it("evaluates the link as a whole in unattached budgets", async () => {
    const paid = await tx(courant, "2026-04-01", -187, cat.courses);
    const received = await tx(joint, "2026-03-31", 187, cat.courses);
    await link(paid, received);
    const unbalanced = await tx(courant, "2026-04-02", -200, cat.courses);
    await link(unbalanced, await tx(courant, "2026-03-30", 150, cat.courses));
    const { mar, apr } = await marchAndApril({ accountId: undefined });
    const m = await getBudgetDetail(mar, owner);
    expect(m.lines[0].spent).toBe(0);
    expect(m.transactionCount).toBe(0);
    const a = await getBudgetDetail(apr, owner);
    expect(a.lines[0].spent).toBe(50);
    expect(a.transactions.map((t) => t.id)).toEqual([unbalanced]);
    expect(await matchesOf(received)).toEqual([]);
  });

  it("keeps a balanced link out of the landing", async () => {
    const now = new Date("2026-04-15T12:00:00.000Z");
    await link(await tx(courant, "2026-04-01", -187), await tx(courant, "2026-03-31", 187));
    const { apr } = await marchAndApril({ outOfBudgetPlanned: 100 });
    const d = await getBudgetDetail(apr, owner, { now });
    expect(d.landing).toMatchObject({ balance: 1000, spendingToCome: 200, endBalance: 800 });
    const [landing] = currentLandings(await listCurrentBudgets(owner, now));
    expect(landing.landing).toEqual(d.landing);
  });

  it("follows the primary's assignments", async () => {
    const paid = await tx(courant, "2026-04-01", -200, cat.courses);
    const received = await tx(courant, "2026-03-31", 187, cat.salary);
    await link(paid, received);
    const { mar, apr } = await marchAndApril();
    await assignTransaction(
      { budgetId: apr, transactionId: received, mode: "INCLUDE" },
      { id: owner },
    );
    expect((await getBudgetDetail(apr, owner)).lines[0].spent).toBe(13);
    expect((await getBudgetDetail(mar, owner)).transactionCount).toBe(0);
    await assignTransaction({ budgetId: apr, transactionId: paid, mode: "EXCLUDE" }, { id: owner });
    expect((await getBudgetDetail(apr, owner)).transactionCount).toBe(0);
    expect((await getBudgetDetail(mar, owner)).transactionCount).toBe(0);
    expect(await matchesOf(received)).toEqual([]);
  });

  it("brings the whole link into a budget that includes any of its members", async () => {
    const paid = await tx(courant, "2026-04-01", -200, cat.courses);
    const received = await tx(courant, "2026-03-31", 187, cat.salary);
    await link(paid, received);
    const { mar } = await marchAndApril();
    const may = await createBudget(input({ name: "Mai", ...mayPeriod }), { id: owner });
    await assignTransaction(
      { budgetId: may.id, transactionId: received, mode: "INCLUDE" },
      { id: owner },
    );
    const d = await getBudgetDetail(may.id, owner);
    expect(d.lines[0].spent).toBe(13);
    expect(d.transactions.map((t) => [t.id, t.amount])).toEqual([[paid, -13]]);
    expect((await getBudgetDetail(mar, owner)).transactionCount).toBe(0);
    expect((await matchesOf(received)).map((m) => m.budgetId)).toContain(may.id);
  });
});
