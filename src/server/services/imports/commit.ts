import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import { buildSecureFields, computeExternalId } from "@/server/services/transactions/secure-fields";
import { recordHits, suggestMany } from "@/server/services/categorization";
import { trimBatchMetadata } from "@/lib/import-status";
import { deriveType } from "./derive-type";
import type { CommitSummary, NormalizedRow } from "./types";

// Dedups against existing `(accountId, externalId)` rows (and in-file dupes),
// encrypts labels, writes per-word search tokens, auto-categorizes, and inserts.
// Does NOT touch the ImportBatch row — callers finalize counters/status. Reused
// by CSV (one account) and PDF (one call per mapped product/account).
export type CommitOptions = {
  autoCategorize?: boolean;
  // Per-row category override, keyed by externalId (from the editable preview).
  overrides?: Record<string, string>;
  // externalIds the user unchecked in the preview — skipped entirely.
  excludedIds?: string[];
};

export type InsertTotals = {
  imported: number;
  skipped: number;
  total: number;
  // Rules that categorized the inserted rows, credited by finalizeBatch.
  hitRuleIds: string[];
};

export async function insertRows(
  target: { batchId: string; accountId: string },
  rows: NormalizedRow[],
  actor: { id: string },
  opts: CommitOptions = {},
): Promise<InsertTotals> {
  const autoCategorize = opts.autoCategorize ?? true;
  const overrides = opts.overrides ?? {};
  const excluded = new Set(opts.excludedIds ?? []);

  // Validate client-supplied override category IDs against the categories the
  // actor can actually use (own + their groups') — never trust them blindly
  // (IDOR). Unknown/foreign IDs are dropped (treated as no override).
  const overrideIds = [...new Set(Object.values(overrides).filter(Boolean))];
  const allowedCategoryIds = overrideIds.length
    ? new Set(
        (
          await db.category.findMany({
            where: {
              id: { in: overrideIds },
              OR: [{ userId: actor.id }, { group: { members: { some: { userId: actor.id } } } }],
            },
            select: { id: true },
          })
        ).map((c) => c.id),
      )
    : new Set<string>();

  const withIds = rows.map((r) => ({
    row: r,
    externalId: computeExternalId(r.date, r.amount, r.rawLabel),
  }));
  const existing = await db.transaction.findMany({
    where: { accountId: target.accountId, externalId: { in: withIds.map((w) => w.externalId) } },
    select: { externalId: true },
  });
  const seen = new Set(existing.map((e) => e.externalId));
  const suggestions = autoCategorize
    ? await suggestMany(
        rows.map((r) => r.rawLabel),
        { userId: actor.id },
      )
    : null;

  let imported = 0;
  let skipped = 0;
  const hitRuleIds: string[] = [];
  for (const [i, { row, externalId }] of withIds.entries()) {
    if (excluded.has(externalId)) continue; // user unchecked this row in the preview
    if (seen.has(externalId)) {
      skipped++;
      continue;
    }
    seen.add(externalId);

    const secure = buildSecureFields({ label: row.rawLabel, rawLabel: row.rawLabel });
    const rawOverride = overrides[externalId];
    // "" is an explicit "Sans catégorie" pick; a foreign category id is dropped.
    const override =
      rawOverride === "" || (rawOverride && allowedCategoryIds.has(rawOverride))
        ? rawOverride
        : undefined;
    const suggestion = override === undefined ? suggestions?.[i] : null;
    const categoryId = override || suggestion?.categoryId || null;
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
        manuallyCategorized: override !== undefined,
        externalId,
        importBatchId: target.batchId,
        createdById: actor.id,
        searchTokens: { create: secure.tokens.map((tokenHash) => ({ tokenHash })) },
      },
    });
    imported++;
    if (suggestion?.ruleId) hitRuleIds.push(suggestion.ruleId);
  }
  return { imported, skipped, total: rows.length, hitRuleIds };
}

// Finalizes an ImportBatch after inserts: sets COMPLETED + counters, audit-logs.
// Rule hits commit with the status so a rolled-back commit can't count them twice.
export async function finalizeBatch(
  batchId: string,
  totals: InsertTotals,
  actor: { id: string },
  accountIds: string[],
): Promise<CommitSummary> {
  const { metadata } = await db.importBatch.findUniqueOrThrow({
    where: { id: batchId },
    select: { metadata: true },
  });
  const updated = await db.$transaction(async (tx) => {
    await recordHits(totals.hitRuleIds, tx);
    return tx.importBatch.update({
      where: { id: batchId },
      data: {
        status: "COMPLETED",
        totalRows: totals.total,
        importedRows: totals.imported,
        skippedRows: totals.skipped,
        completedAt: new Date(),
        metadata: trimBatchMetadata(metadata, accountIds),
      },
    });
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
  return finalizeBatch(batch.id, totals, actor, [batch.accountId]);
}
