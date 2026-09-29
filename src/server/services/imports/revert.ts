import { db } from "@/server/db";
import { canWriteAccount } from "@/server/services/accounts/sharing";
import { listVisibleForUser } from "@/server/services/accounts";
import { logEvent } from "@/server/services/audit";
import {
  canDiscard,
  canRevert,
  trimBatchMetadata,
  UNCOMMITTED_STATUSES,
} from "@/lib/import-status";
import { ImportAccessError } from "./index";

export type RevertImpact = {
  transactions: number;
  linked: number;
  budgeted: number;
  edited: number;
};

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
  const accountIds = [...new Set([batch.accountId, ...rows.map((r) => r.accountId)])];
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
  return { transactions, linked, budgeted, edited };
}

export async function revertImport(
  actorId: string,
  batchId: string,
): Promise<{ deleted: number; linksDissolved: number }> {
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

    const memberships = await tx.transactionLinkMember.findMany({
      where: { transaction: { importBatchId: batchId } },
      select: { linkId: true },
    });
    const linkIds = [...new Set(memberships.map((m) => m.linkId))];
    const { count: deleted } = await tx.transaction.deleteMany({
      where: { importBatchId: batchId },
    });
    const remaining = await tx.transactionLinkMember.groupBy({
      by: ["linkId"],
      where: { linkId: { in: linkIds } },
      _count: { _all: true },
    });
    const kept = new Set(remaining.filter((r) => r._count._all >= 2).map((r) => r.linkId));
    const dissolved = linkIds.filter((id) => !kept.has(id));
    await tx.transactionLink.deleteMany({ where: { id: { in: dissolved } } });
    return { deleted, linksDissolved: dissolved.length };
  });
  await logEvent({
    userId: actorId,
    action: "import.reverted",
    entity: "ImportBatch",
    entityId: batchId,
    metadata: result,
  });
  return result;
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
  const visible = await listVisibleForUser(userId);
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
