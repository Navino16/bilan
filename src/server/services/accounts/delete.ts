import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { LONG_TX_TIMEOUT } from "@/server/db/timeouts";
import { dissolveUndersizedLinks } from "@/server/services/links/dissolve";
import { revokeHits } from "@/server/services/categorization";
import { confirmsAccountName } from "@/lib/validation/account";
import { AccountAccessError, ownedOrThrow } from "./index";

type Client = Prisma.TransactionClient;

export type AccountDeleteImpact = {
  name: string;
  transactions: number;
  imports: number; // history entries (COMPLETED/REVERTED) that disappear
  sharedWith: string[];
  budgetLines: number; // account-scoped lines of budgets that keep other lines
  emptiedBudgets: string[]; // budgets whose every line targets this account
  dissolvedLinks: number;
};

type BatchMeta = { accountIds?: string[]; ruleHits?: Record<string, number> };
type BatchRow = { id: string; accountId: string; status: string; metadata: unknown };
type BatchPlan = {
  deleted: BatchRow[];
  reattached: { id: string; accountId: string; metadata: BatchMeta }[];
  trimmed: { id: string; metadata: BatchMeta }[];
};

const HISTORY_STATUSES = ["COMPLETED", "REVERTED"];

// A multi-account PDF batch outlives the account: it moves to a surviving account
// it imported into, and the deleted one leaves its `accountIds`.
async function planBatches(client: Client, accountId: string): Promise<BatchPlan> {
  const rowBatches = await client.transaction.findMany({
    where: { accountId, importBatchId: { not: null } },
    select: { importBatchId: true },
    distinct: ["importBatchId"],
  });
  const batches: BatchRow[] = await client.importBatch.findMany({
    where: {
      OR: [
        { accountId },
        { id: { in: rowBatches.map((r) => r.importBatchId!) } },
        { metadata: { path: "$.accountIds", array_contains: [accountId] } },
      ],
    },
    select: { id: true, accountId: true, status: true, metadata: true },
  });
  const otherRows = await client.transaction.findMany({
    where: { importBatchId: { in: batches.map((b) => b.id) }, accountId: { not: accountId } },
    select: { importBatchId: true, accountId: true },
    distinct: ["importBatchId", "accountId"],
  });
  const listed = (b: BatchRow) => (b.metadata as BatchMeta | null)?.accountIds ?? [b.accountId];
  const candidates = new Set([...batches.flatMap(listed), ...otherRows.map((r) => r.accountId)]);
  candidates.delete(accountId);
  const existing = new Set(
    (
      await client.bankAccount.findMany({
        where: { id: { in: [...candidates] } },
        select: { id: true },
      })
    ).map((a) => a.id),
  );

  const plan: BatchPlan = { deleted: [], reattached: [], trimmed: [] };
  for (const b of batches) {
    const meta = (b.metadata ?? {}) as BatchMeta;
    const remaining = [
      ...new Set([
        ...listed(b),
        ...otherRows.filter((r) => r.importBatchId === b.id).map((r) => r.accountId),
      ]),
    ].filter((id) => id !== accountId && existing.has(id));
    if (b.accountId !== accountId) {
      plan.trimmed.push({ id: b.id, metadata: { ...meta, accountIds: remaining } });
    } else if (remaining.length === 0) {
      plan.deleted.push(b);
    } else {
      plan.reattached.push({
        id: b.id,
        accountId: remaining[0],
        metadata: { ...meta, accountIds: remaining },
      });
    }
  }
  return plan;
}

async function emptiedBudgets(client: Client, accountId: string) {
  return client.budget.findMany({
    where: { lines: { some: { accountId }, every: { accountId } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

// Links holding a transaction of this account that would keep fewer than 2 members.
async function linksDissolvedBy(accountId: string): Promise<number> {
  const memberships = await db.transactionLinkMember.findMany({
    where: { transaction: { accountId } },
    select: { linkId: true },
  });
  const linkIds = [...new Set(memberships.map((m) => m.linkId))];
  if (linkIds.length === 0) return 0;
  const kept = await db.transactionLinkMember.groupBy({
    by: ["linkId"],
    where: { linkId: { in: linkIds }, transaction: { accountId: { not: accountId } } },
    _count: { _all: true },
  });
  return linkIds.length - kept.filter((k) => k._count._all >= 2).length;
}

export async function getAccountDeleteImpact(
  id: string,
  actor: { id: string },
): Promise<AccountDeleteImpact> {
  const acc = await ownedOrThrow(id, actor.id);
  const [transactions, plan, shares, emptied, dissolvedLinks] = await Promise.all([
    db.transaction.count({ where: { accountId: id } }),
    planBatches(db, id),
    db.accountShare.findMany({
      where: { accountId: id },
      select: { group: { select: { name: true } } },
    }),
    emptiedBudgets(db, id),
    linksDissolvedBy(id),
  ]);
  const budgetLines = await db.budgetLine.count({
    where: { accountId: id, budgetId: { notIn: emptied.map((b) => b.id) } },
  });
  return {
    name: acc.name,
    transactions,
    imports: plan.deleted.filter((b) => HISTORY_STATUSES.includes(b.status)).length,
    sharedWith: shares.map((s) => s.group.name),
    budgetLines,
    emptiedBudgets: emptied.map((b) => b.name),
    dissolvedLinks,
  };
}

// Account-scoped budget lines are deleted, not left to the FK's SET NULL, which
// would widen them to every account.
export async function deleteAccount(
  id: string,
  actor: { id: string },
  confirmName: string,
): Promise<{ transactions: number; linksDissolved: number }> {
  const acc = await ownedOrThrow(id, actor.id);
  if (!confirmsAccountName(confirmName, acc.name)) throw new AccountAccessError("CONFIRMATION");
  return db.$transaction(async (tx) => {
    const memberships = await tx.transactionLinkMember.findMany({
      where: { transaction: { accountId: id } },
      select: { linkId: true },
    });
    const transactions = await tx.transaction.count({ where: { accountId: id } });
    const shares = await tx.accountShare.count({ where: { accountId: id } });

    const plan = await planBatches(tx, id);
    for (const b of plan.reattached) {
      await tx.importBatch.update({
        where: { id: b.id },
        data: { accountId: b.accountId, metadata: b.metadata },
      });
    }
    for (const b of plan.trimmed) {
      await tx.importBatch.update({ where: { id: b.id }, data: { metadata: b.metadata } });
    }
    // Per-account hit counts aren't stored: a surviving batch keeps its ruleHits,
    // revoked in full if it is reverted later.
    for (const b of plan.deleted) {
      if (b.status === "COMPLETED") await revokeHits((b.metadata as BatchMeta)?.ruleHits ?? {}, tx);
    }

    const emptied = await emptiedBudgets(tx, id);
    await tx.budget.deleteMany({ where: { id: { in: emptied.map((b) => b.id) } } });
    const { count: budgetLines } = await tx.budgetLine.deleteMany({ where: { accountId: id } });
    await tx.bankAccount.delete({ where: { id } });
    const linksDissolved = await dissolveUndersizedLinks(tx, [
      ...new Set(memberships.map((m) => m.linkId)),
    ]);
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: "account.deleted",
        entity: "BankAccount",
        entityId: id,
        metadata: {
          transactions,
          imports: plan.deleted.length,
          importsReattached: plan.reattached.length,
          shares,
          budgetLines,
          budgetsDeleted: emptied.length,
          linksDissolved,
        },
      },
    });
    return { transactions, linksDissolved };
  }, LONG_TX_TIMEOUT);
}
