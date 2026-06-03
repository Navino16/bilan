import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import { buildSecureFields, computeExternalId } from "@/server/services/transactions/secure-fields";
import { suggest } from "@/server/services/categorization";
import { deriveType } from "./derive-type";
import type { CommitSummary, NormalizedRow } from "./types";

// Dedups against existing `(accountId, externalId)` rows (and in-file dupes),
// encrypts labels, writes per-word search tokens, auto-categorizes, and inserts.
// Does NOT touch the ImportBatch row — callers finalize counters/status. Reused
// by CSV (one account) and PDF (one call per mapped product/account).
export type CommitOptions = { autoCategorize?: boolean };

export async function insertRows(
  target: { batchId: string; accountId: string },
  rows: NormalizedRow[],
  actor: { id: string },
  opts: CommitOptions = {},
): Promise<{ imported: number; skipped: number; total: number }> {
  const autoCategorize = opts.autoCategorize ?? true;
  const withIds = rows.map((r) => ({
    row: r,
    externalId: computeExternalId(r.date, r.amount, r.rawLabel),
  }));
  const existing = await db.transaction.findMany({
    where: { accountId: target.accountId, externalId: { in: withIds.map((w) => w.externalId) } },
    select: { externalId: true },
  });
  const seen = new Set(existing.map((e) => e.externalId));

  let imported = 0;
  let skipped = 0;
  for (const { row, externalId } of withIds) {
    if (seen.has(externalId)) {
      skipped++;
      continue;
    }
    seen.add(externalId);

    const secure = buildSecureFields({ label: row.rawLabel, rawLabel: row.rawLabel });
    const categoryId = autoCategorize
      ? (await suggest(row.rawLabel, { userId: actor.id })).categoryId
      : null;
    await db.transaction.create({
      data: {
        accountId: target.accountId,
        date: row.date,
        amount: row.amount,
        type: deriveType(row.rawLabel),
        labelEnc: secure.labelEnc,
        labelHash: secure.labelHash,
        rawLabelEnc: secure.rawLabelEnc,
        rawLabelHash: secure.rawLabelHash,
        noteEnc: null,
        categoryId,
        manuallyCategorized: false,
        externalId,
        importBatchId: target.batchId,
        createdById: actor.id,
        searchTokens: { create: secure.tokens.map((tokenHash) => ({ tokenHash })) },
      },
    });
    imported++;
  }
  return { imported, skipped, total: rows.length };
}

// Finalizes an ImportBatch after inserts: sets COMPLETED + counters, audit-logs.
export async function finalizeBatch(
  batchId: string,
  totals: { imported: number; skipped: number; total: number },
  actor: { id: string },
): Promise<CommitSummary> {
  const updated = await db.importBatch.update({
    where: { id: batchId },
    data: {
      status: "COMPLETED",
      totalRows: totals.total,
      importedRows: totals.imported,
      skippedRows: totals.skipped,
      completedAt: new Date(),
    },
  });
  await logEvent({
    userId: actor.id,
    action: "import.committed",
    entity: "ImportBatch",
    entityId: batchId,
    metadata: { imported: totals.imported, skipped: totals.skipped, total: totals.total },
  });
  return {
    batchId: updated.id,
    totalRows: totals.total,
    importedRows: totals.imported,
    skippedRows: totals.skipped,
  };
}

// CSV path: insert into the batch's single account, then finalize.
export async function commitRows(
  batch: { id: string; accountId: string },
  rows: NormalizedRow[],
  actor: { id: string },
  opts: CommitOptions = {},
): Promise<CommitSummary> {
  const totals = await insertRows(
    { batchId: batch.id, accountId: batch.accountId },
    rows,
    actor,
    opts,
  );
  return finalizeBatch(batch.id, totals, actor);
}
