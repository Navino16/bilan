import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import { buildSecureFields, computeExternalId } from "@/server/services/transactions/secure-fields";
import { suggest } from "@/server/services/categorization";
import type { CommitSummary, NormalizedRow } from "./types";

// Shared by CSV (4.2) and PDF (4.3b). Authorization + batch existence are the
// caller's responsibility. Dedups against existing `(accountId, externalId)`
// rows (including duplicates within the same file), encrypts labels, writes
// per-word search tokens, auto-categorizes, and updates the batch counters.
export async function commitRows(
  batch: { id: string; accountId: string },
  rows: NormalizedRow[],
  actor: { id: string },
): Promise<CommitSummary> {
  // Pre-compute externalIds and load the ones that already exist for the account.
  const withIds = rows.map((r) => ({
    row: r,
    externalId: computeExternalId(r.date, r.amount, r.rawLabel),
  }));
  const existing = await db.transaction.findMany({
    where: { accountId: batch.accountId, externalId: { in: withIds.map((w) => w.externalId) } },
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
    seen.add(externalId); // guards against in-file duplicates too

    const secure = buildSecureFields({ label: row.rawLabel, rawLabel: row.rawLabel });
    const suggestion = await suggest(row.rawLabel, { userId: actor.id });
    await db.transaction.create({
      data: {
        accountId: batch.accountId,
        date: row.date,
        amount: row.amount,
        type: "OTHER",
        labelEnc: secure.labelEnc,
        labelHash: secure.labelHash,
        rawLabelEnc: secure.rawLabelEnc,
        rawLabelHash: secure.rawLabelHash,
        noteEnc: null,
        categoryId: suggestion.categoryId,
        manuallyCategorized: false,
        externalId,
        importBatchId: batch.id,
        createdById: actor.id,
        searchTokens: { create: secure.tokens.map((tokenHash) => ({ tokenHash })) },
      },
    });
    imported++;
  }

  const updated = await db.importBatch.update({
    where: { id: batch.id },
    data: {
      status: "COMPLETED",
      totalRows: rows.length,
      importedRows: imported,
      skippedRows: skipped,
      completedAt: new Date(),
    },
  });
  await logEvent({
    userId: actor.id,
    action: "import.committed",
    entity: "ImportBatch",
    entityId: batch.id,
    metadata: { imported, skipped, total: rows.length },
  });
  return {
    batchId: updated.id,
    totalRows: rows.length,
    importedRows: imported,
    skippedRows: skipped,
  };
}
