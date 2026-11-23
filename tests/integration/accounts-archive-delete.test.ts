import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import {
  archiveAccount,
  unarchiveAccount,
  listVisibleForUser,
  visibleAccountIds,
  AccountAccessError,
} from "@/server/services/accounts";
import { deleteAccount, getAccountDeleteImpact } from "@/server/services/accounts/delete";
import { createBudget, getBudgetDetail } from "@/server/services/budgets";
import { getDashboard } from "@/server/services/dashboard";
import { createTransaction, listTransactions } from "@/server/services/transactions";
import { createCsvBatch, commitCsvBatch } from "@/server/services/imports";
import {
  commitPdfBatch,
  createPdfBatch,
  previewPdfBatch,
} from "@/server/services/imports/pdf-service";
import { createLink } from "@/server/services/links";
import { comparisonFor, monthPeriod } from "@/lib/period";

const owner = "arcdel_owner";
const member = "arcdel_member";
const stranger = "arcdel_stranger";
const users = [owner, member, stranger];
let groupId: string;

async function account(name: string): Promise<string> {
  return (await db.bankAccount.create({ data: { ownerId: owner, name, type: "CHECKING" } })).id;
}

async function tx(
  accountId: string,
  amount: number,
  importBatchId: string | null = null,
): Promise<string> {
  const s = buildSecureFields({ label: "T", rawLabel: `T${amount}` });
  const row = await db.transaction.create({
    data: {
      accountId,
      date: new Date("2026-03-10"),
      amount,
      type: "OTHER",
      labelEnc: s.labelEnc,
      labelHash: s.labelHash,
      rawLabelEnc: s.rawLabelEnc,
      rawLabelHash: s.rawLabelHash,
      createdById: owner,
      importBatchId,
    },
  });
  return row.id;
}

async function batch(accountId: string, metadata: object, status = "COMPLETED") {
  return (
    await db.importBatch.create({
      data: { accountId, source: "PDF", status, createdById: owner, metadata: metadata as never },
    })
  ).id;
}

const marchBudget = (lines: { accountId?: string; plannedAmount: number }[], name = "Mars") =>
  createBudget(
    { name, periodType: "MONTH", periodStart: "2026-03-01", periodEnd: "2026-03-31", lines },
    { id: owner },
  );

async function cleanup() {
  await db.transactionLink.deleteMany({ where: { createdById: { in: users } } });
  await db.budget.deleteMany({ where: { userId: { in: users } } });
  await db.bankAccount.deleteMany({ where: { ownerId: { in: users } } });
  await db.categorizationRule.deleteMany({ where: { userId: { in: users } } });
  await db.category.deleteMany({ where: { userId: { in: users } } });
  await db.group.deleteMany({ where: { createdById: owner } });
  await db.auditLog.deleteMany({ where: { userId: { in: users } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
}

beforeAll(async () => {
  await cleanup();
  for (const id of users) await db.user.create({ data: { id, email: `${id}@bilan.local` } });
  groupId = (await db.group.create({ data: { name: "Foyer ArcDel", createdById: owner } })).id;
  await db.groupMember.createMany({
    data: [
      { groupId, userId: owner, role: "OWNER" },
      { groupId, userId: member, role: "MEMBER" },
    ],
  });
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("archive / unarchive", () => {
  it("hides an archived account from pickers only, and unarchive restores it", async () => {
    const id = await account("Ancien livret");
    await archiveAccount(id, { id: owner });

    expect((await listVisibleForUser(owner)).some((a) => a.id === id)).toBe(false);
    const all = await listVisibleForUser(owner, { includeArchived: true });
    expect(all.find((a) => a.id === id)?.archived).toBe(true);
    expect(await visibleAccountIds(owner)).toContain(id);

    await unarchiveAccount(id, { id: owner });
    expect((await listVisibleForUser(owner)).find((a) => a.id === id)?.archived).toBe(false);
    expect(await db.auditLog.count({ where: { action: "account.unarchived", entityId: id } })).toBe(
      1,
    );
  });

  it("only the owner can unarchive, not a member with WRITE access", async () => {
    const id = await account("Pas à toi");
    await db.accountShare.create({
      data: { accountId: id, groupId, permission: "WRITE", createdById: owner },
    });
    await archiveAccount(id, { id: owner });
    await expect(unarchiveAccount(id, { id: member })).rejects.toBeInstanceOf(AccountAccessError);
  });

  it("visibleAccountIds covers archived shared accounts, never a stranger's", async () => {
    const id = await account("Partagé archivé");
    await db.accountShare.create({
      data: { accountId: id, groupId, permission: "READ", createdById: owner },
    });
    await archiveAccount(id, { id: owner });
    expect(await visibleAccountIds(member)).toContain(id);
    expect(await visibleAccountIds(stranger)).not.toContain(id);
  });

  it("an archived account's transactions still count in history and budgets (#174)", async () => {
    const id = await account("Clôturé");
    await tx(id, -42);
    const { id: budgetId } = await marchBudget([{ accountId: id, plannedAmount: 100 }]);
    await archiveAccount(id, { id: owner });

    expect((await getBudgetDetail(budgetId, owner)).spentTotal).toBe(42);
    const { items } = await listTransactions(owner, { accountId: id });
    expect(items).toHaveLength(1);
    const period = monthPeriod(2026, 3);
    const dash = await getDashboard(owner, period, comparisonFor(period, "prev", new Date()));
    expect(dash.totals.expense).toBe(42);
  });
});

describe("archived accounts refuse new rows", () => {
  let archived: string;
  let active: string;

  beforeAll(async () => {
    archived = await account("Archivé saisie");
    active = await account("Actif saisie");
    await archiveAccount(archived, { id: owner });
  });

  it("refuses a manual transaction", async () => {
    await expect(
      createTransaction(
        { accountId: archived, date: "2026-03-01", amount: "-5", type: "OTHER", label: "X" },
        { id: owner },
      ),
    ).rejects.toThrow("ACCOUNT_ARCHIVED");
  });

  it("refuses a CSV or PDF batch on it, and a commit once it was archived", async () => {
    await expect(
      createCsvBatch({ accountId: archived, filename: "a.csv", text: "x" }, { id: owner }),
    ).rejects.toThrow("ACCOUNT_ARCHIVED");
    await expect(
      createPdfBatch(
        { accountId: archived, filename: "a.pdf", buffer: Buffer.from("x") },
        {
          id: owner,
        },
      ),
    ).rejects.toThrow("ACCOUNT_ARCHIVED");

    const later = await account("Archivé en cours");
    const { id } = await createCsvBatch(
      { accountId: later, filename: "b.csv", text: "date;label;amount\n01/03/2026;X;-5\n" },
      { id: owner },
    );
    await archiveAccount(later, { id: owner });
    await expect(
      commitCsvBatch(id, { date: "date", label: "label", amount: "amount" }, { id: owner }),
    ).rejects.toThrow("ACCOUNT_ARCHIVED");
  });

  it("refuses to map a PDF product to it", async () => {
    const id = await batch(
      active,
      {
        bank: null,
        products: [{ key: "p1", rows: [{ date: "2026-03-01", amount: -5, rawLabel: "X" }] }],
      },
      "REVIEW",
    );
    await expect(previewPdfBatch(id, owner, { accounts: { p1: archived } })).rejects.toThrow(
      "ACCOUNT_ARCHIVED",
    );
    await expect(commitPdfBatch(id, { p1: archived }, { id: owner })).rejects.toThrow(
      "ACCOUNT_ARCHIVED",
    );
    expect(await db.transaction.count({ where: { accountId: archived } })).toBe(0);
  });
});

describe("deleteAccount", () => {
  let doomed: string;
  let kept: string;
  let pairLink: string;
  let trioLink: string;
  let keptLine: string;
  let budgetId: string;
  let soloBudgetId: string;
  let ruleId: string;
  let soloBatch: string;
  let movedBatch: string;
  let trimmedBatch: string;
  let revertedBatch: string;

  beforeAll(async () => {
    doomed = await account("À supprimer");
    kept = await account("Gardé");
    await db.accountShare.create({
      data: { accountId: doomed, groupId, permission: "WRITE", createdById: owner },
    });
    const categoryId = (await db.category.create({ data: { userId: owner, name: "Règle" } })).id;
    ruleId = (
      await db.categorizationRule.create({
        data: { userId: owner, categoryId, pattern: "T", matchType: "CONTAINS", hits: 10 },
      })
    ).id;

    // Only on the doomed account: deleted with it, its rule hits revoked.
    soloBatch = await batch(doomed, { accountIds: [doomed], ruleHits: { [ruleId]: 3 } });
    const outgoing = await tx(doomed, -100, soloBatch);
    // Uploaded on the doomed account, products on both: moves to the kept account.
    movedBatch = await batch(doomed, { accountIds: [doomed, kept], ruleHits: { [ruleId]: 2 } });
    const extra = await tx(doomed, -5, movedBatch);
    const movedRow = await tx(kept, 7, movedBatch);
    // Uploaded on the kept account with a product on the doomed one: only shrinks.
    trimmedBatch = await batch(kept, { accountIds: [kept, doomed] });
    await tx(doomed, -1, trimmedBatch);
    await tx(kept, 1, trimmedBatch);
    // Already reverted, no rows left: found through its metadata alone.
    revertedBatch = await batch(kept, { accountIds: [kept, doomed] }, "REVERTED");

    pairLink = (
      await createLink({ transactionIds: [outgoing, await tx(kept, 100)], userId: owner })
    ).id;
    trioLink = (
      await createLink({ transactionIds: [extra, movedRow, await tx(kept, 3)], userId: owner })
    ).id;
    budgetId = (
      await marchBudget(
        [
          { accountId: doomed, plannedAmount: 50 },
          { accountId: kept, plannedAmount: 60 },
        ],
        "Mixte",
      )
    ).id;
    soloBudgetId = (await marchBudget([{ accountId: doomed, plannedAmount: 20 }], "Solo")).id;
    keptLine = (await db.budgetLine.findFirstOrThrow({ where: { budgetId, accountId: kept } })).id;
  });

  it("reports the impact to the owner only", async () => {
    expect(await getAccountDeleteImpact(doomed, { id: owner })).toEqual({
      name: "À supprimer",
      transactions: 3,
      imports: 1,
      sharedWith: ["Foyer ArcDel"],
      budgetLines: 1,
      emptiedBudgets: ["Solo"],
      dissolvedLinks: 1,
    });
    await expect(getAccountDeleteImpact(doomed, { id: member })).rejects.toBeInstanceOf(
      AccountAccessError,
    );
  });

  it("refuses a non-owner (even with WRITE) and a mismatched typed name", async () => {
    await expect(deleteAccount(doomed, { id: member }, "À supprimer")).rejects.toThrow("FORBIDDEN");
    await expect(deleteAccount(doomed, { id: owner }, "À suppr")).rejects.toThrow("CONFIRMATION");
    expect(await db.bankAccount.count({ where: { id: doomed } })).toBe(1);
  });

  it("deletes the account and everything that only made sense with it", async () => {
    const result = await deleteAccount(doomed, { id: owner }, "  À supprimer ");
    expect(result).toEqual({ transactions: 3, linksDissolved: 1 });

    expect(await db.bankAccount.count({ where: { id: doomed } })).toBe(0);
    expect(await db.transaction.count({ where: { accountId: doomed } })).toBe(0);
    expect(await db.accountShare.count({ where: { accountId: doomed } })).toBe(0);
    // The account-scoped line goes rather than widening to every account.
    const lines = await db.budgetLine.findMany({ where: { budgetId } });
    expect(lines.map((l) => l.id)).toEqual([keptLine]);
    expect(await db.budget.count({ where: { id: soloBudgetId } })).toBe(0);
    expect(await db.transactionLink.count({ where: { id: pairLink } })).toBe(0);
    expect(await db.transactionLinkMember.count({ where: { linkId: trioLink } })).toBe(2);

    expect(await db.importBatch.count({ where: { id: soloBatch } })).toBe(0);
    const moved = await db.importBatch.findUniqueOrThrow({ where: { id: movedBatch } });
    expect(moved.accountId).toBe(kept);
    expect(moved.metadata).toEqual({ accountIds: [kept], ruleHits: { [ruleId]: 2 } });
    expect(await db.transaction.count({ where: { importBatchId: movedBatch } })).toBe(1);
    const trimmed = await db.importBatch.findUniqueOrThrow({ where: { id: trimmedBatch } });
    expect(trimmed.metadata).toEqual({ accountIds: [kept] });
    const reverted = await db.importBatch.findUniqueOrThrow({ where: { id: revertedBatch } });
    expect(reverted.metadata).toEqual({ accountIds: [kept] });
    const rule = await db.categorizationRule.findUniqueOrThrow({ where: { id: ruleId } });
    expect(rule.hits).toBe(7);

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: "account.deleted", entityId: doomed },
    });
    expect(audit.userId).toBe(owner);
    expect(audit.metadata).toEqual({
      transactions: 3,
      imports: 1,
      importsReattached: 1,
      shares: 1,
      budgetLines: 1,
      budgetsDeleted: 1,
      linksDissolved: 1,
    });
  });

  it("accepts the name typed with a typographic apostrophe", async () => {
    const id = await account("Livret d'épargne");
    await deleteAccount(id, { id: owner }, "Livret d’épargne");
    expect(await db.bankAccount.count({ where: { id } })).toBe(0);
  });
});
