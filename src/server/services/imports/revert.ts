import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { LONG_TX_TIMEOUT } from "@/server/db/timeouts";
import { canWriteAccount } from "@/server/services/accounts/sharing";
import { listVisibleForUser } from "@/server/services/accounts";
import { logEvent } from "@/server/services/audit";
import { dissolveUndersizedLinks } from "@/server/services/links/dissolve";
import { revokeHits } from "@/server/services/categorization";
import {
  canDiscard,
  canRevert,
  trimBatchMetadata,
  type BalanceAdjustment,
  UNCOMMITTED_STATUSES,
} from "@/lib/import-status";
import { ImportAccessError } from "./errors";

export type RevertImpact = {
  transactions: number;
  linked: number;
  budgeted: number;
  edited: number;
  balances: { accountName: string; previous: number; set: number; restore: boolean }[];
};

// initialBalance is Decimal(12,2) and the recorded amounts are JSON numbers: compare at cent precision.
const cents = (n: number) => new Prisma.Decimal(n.toFixed(2));

const adjustmentsOf = (meta: unknown): BalanceAdjustment[] =>
  (meta as { balanceAdjustments?: BalanceAdjustment[] } | null)?.balanceAdjustments ?? [];

// Write access is required on every account the batch touched: a PDF batch maps
// each product to its own account (spec D2).
async function loadRevertable(actorId: string, batchId: string) {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new ImportAccessError("NOT_FOUND");
  const rows = await db.transaction.findMany({
    where: { importBatchId: batchId },
    select: { accountId: true },
    distinct: ["accountId"],
  });
  const accountIds = [
    ...new Set([
      batch.accountId,
      ...rows.map((r) => r.accountId),
      ...adjustmentsOf(batch.metadata).map((a) => a.accountId),
    ]),
  ];
  for (const id of accountIds) {
    if (!(await canWriteAccount(actorId, id))) throw new ImportAccessError("FORBIDDEN");
  }
  if (!canRevert(batch.status)) throw new ImportAccessError("NOT_REVERTIBLE");
  return batch;
}

export async function getRevertImpact(actorId: string, batchId: string): Promise<RevertImpact> {
  const batch = await loadRevertable(actorId, batchId);
  const where = { importBatchId: batchId };
  const [transactions, linked, budgeted, edited] = await Promise.all([
    db.transaction.count({ where }),
    db.transaction.count({ where: { ...where, linkMembership: { isNot: null } } }),
    db.transaction.count({ where: { ...where, budgetAssignments: { some: {} } } }),
    db.transaction.count({
      where: { ...where, updatedAt: { gt: batch.completedAt ?? batch.createdAt } },
    }),
  ]);
  const adjustments = adjustmentsOf(batch.metadata);
  const accounts = await db.bankAccount.findMany({
    where: { id: { in: adjustments.map((a) => a.accountId) } },
    select: { id: true, name: true, initialBalance: true },
  });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const balances = adjustments.flatMap((a) => {
    const account = byId.get(a.accountId);
    if (!account) return [];
    return [
      {
        accountName: account.name,
        previous: a.previous,
        set: a.set,
        restore: account.initialBalance.equals(cents(a.set)),
      },
    ];
  });
  return { transactions, linked, budgeted, edited, balances };
}

export async function revertImport(
  actorId: string,
  batchId: string,
): Promise<{
  deleted: number;
  linksDissolved: number;
  balancesRestored: number;
  balancesKept: number;
}> {
  const batch = await loadRevertable(actorId, batchId);
  const accountIds = (batch.metadata as { accountIds?: string[] } | null)?.accountIds ?? [
    batch.accountId,
  ];
  const result = await db.$transaction(async (tx) => {
    // Claiming the status first makes a concurrent second revert find nothing to flip.
    const claimed = await tx.importBatch.updateMany({
      where: { id: batchId, status: "COMPLETED" },
      data: { status: "REVERTED", metadata: trimBatchMetadata(batch.metadata, accountIds) },
    });
    if (claimed.count === 0) throw new ImportAccessError("NOT_REVERTIBLE");
    await revokeHits(
      (batch.metadata as { ruleHits?: Record<string, number> } | null)?.ruleHits ?? {},
      tx,
    );

    const memberships = await tx.transactionLinkMember.findMany({
      where: { transaction: { importBatchId: batchId } },
      select: { linkId: true },
    });
    const linkIds = [...new Set(memberships.map((m) => m.linkId))];
    const { count: deleted } = await tx.transaction.deleteMany({
      where: { importBatchId: batchId },
    });
    const linksDissolved = await dissolveUndersizedLinks(tx, linkIds);

    // Conditional on the value the import set: a hand edit since then wins.
    const restored: BalanceAdjustment[] = [];
    for (const a of adjustmentsOf(batch.metadata)) {
      const { count } = await tx.bankAccount.updateMany({
        where: { id: a.accountId, initialBalance: cents(a.set) },
        data: { initialBalance: cents(a.previous) },
      });
      if (count > 0) restored.push(a);
    }
    return {
      deleted,
      linksDissolved,
      restored,
      kept: adjustmentsOf(batch.metadata).length - restored.length,
    };
  }, LONG_TX_TIMEOUT);
  const { restored, kept, ...counts } = result;
  const summary = { ...counts, balancesRestored: restored.length, balancesKept: kept };
  await logEvent({
    userId: actorId,
    action: "import.reverted",
    entity: "ImportBatch",
    entityId: batchId,
    metadata: summary,
  });
  for (const a of restored) {
    await logEvent({
      userId: actorId,
      action: "account.initial_balance_restored",
      entity: "BankAccount",
      entityId: a.accountId,
      metadata: { previous: a.set, set: a.previous, batchId },
    });
  }
  return summary;
}

export async function discardBatch(actorId: string, batchId: string): Promise<void> {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) return; // already discarded or purged
  if (!(await canWriteAccount(actorId, batch.accountId))) throw new ImportAccessError("FORBIDDEN");
  if (!canDiscard(batch.status)) throw new ImportAccessError("NOT_DISCARDABLE");
  await db.importBatch.deleteMany({
    where: { id: batchId, status: { in: [...UNCOMMITTED_STATUSES] } },
  });
  await logEvent({
    userId: actorId,
    action: "import.discarded",
    entity: "ImportBatch",
    entityId: batchId,
  });
}

export type ImportHistoryItem = {
  id: string;
  createdAt: Date;
  source: string;
  filename: string | null;
  status: "COMPLETED" | "REVERTED";
  importedRows: number;
  skippedRows: number;
  accountNames: string[];
};

export async function listRecentImports(userId: string, limit = 20): Promise<ImportHistoryItem[]> {
  const visible = await listVisibleForUser(userId, { includeArchived: true });
  const names = new Map(visible.map((a) => [a.id, a.name]));
  const writable = visible.filter((a) => a.access === "OWNER" || a.access === "WRITE");
  const batches = await db.importBatch.findMany({
    where: {
      accountId: { in: writable.map((a) => a.id) },
      status: { in: ["COMPLETED", "REVERTED"] },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return batches.map((b) => {
    const ids = (b.metadata as { accountIds?: string[] } | null)?.accountIds ?? [b.accountId];
    return {
      id: b.id,
      createdAt: b.createdAt,
      source: b.source,
      filename: b.filename,
      status: b.status as ImportHistoryItem["status"],
      importedRows: b.importedRows,
      skippedRows: b.skippedRows,
      accountNames: ids.flatMap((id) => names.get(id) ?? []),
    };
  });
}

// A batch still COMMITTING a day later was left by a crashed commit: its partial rows go too.
export async function purgeStaleImports(cutoff: Date): Promise<number> {
  const stale = await db.importBatch.findMany({
    where: {
      status: { in: [...UNCOMMITTED_STATUSES, "COMMITTING"] },
      createdAt: { lt: cutoff },
    },
    select: { id: true },
  });
  const ids = stale.map((b) => b.id);
  if (ids.length === 0) return 0;
  const [, { count }] = await db.$transaction([
    db.transaction.deleteMany({ where: { importBatchId: { in: ids } } }),
    db.importBatch.deleteMany({ where: { id: { in: ids } } }),
  ]);
  return count;
}
