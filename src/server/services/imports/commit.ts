import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import {
  buildSecureFields,
  computeExternalIds,
} from "@/server/services/transactions/secure-fields";
import { recordHits, suggestMany } from "@/server/services/categorization";
import { trimBatchMetadata } from "@/lib/import-status";
import { deriveType } from "./derive-type";
import { ImportAccessError } from "./errors";
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

const INSERT_CHUNK = 500;

export async function insertRows(
  target: { batchId: string; accountId: string; progressOffset?: number },
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

  const externalIds = computeExternalIds(rows);
  const existing = await db.transaction.findMany({
    where: { accountId: target.accountId, externalId: { in: externalIds } },
    select: { externalId: true },
  });
  const seen = new Set(existing.map((e) => e.externalId));
  const suggestions = autoCategorize
    ? await suggestMany(
        rows.map((r) => r.rawLabel),
        { userId: actor.id },
      )
    : null;

  let skipped = 0;
  const pending: {
    data: Prisma.TransactionCreateManyInput;
    externalId: string;
    tokens: string[];
    ruleId: string | null;
  }[] = [];
  for (const [i, row] of rows.entries()) {
    const externalId = externalIds[i];
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
    pending.push({
      data: {
        accountId: target.accountId,
        date: row.date,
        amount: row.amount,
        type: row.type ?? deriveType(row.rawLabel),
        labelEnc: secure.labelEnc,
        labelHash: secure.labelHash,
        rawLabelEnc: secure.rawLabelEnc,
        rawLabelHash: secure.rawLabelHash,
        merchantKeyHash: secure.merchantKeyHash,
        noteEnc: null,
        categoryId: override || suggestion?.categoryId || null,
        manuallyCategorized: override !== undefined,
        externalId,
        importBatchId: target.batchId,
        createdById: actor.id,
      },
      externalId,
      tokens: secure.tokens,
      ruleId: suggestion?.ruleId ?? null,
    });
  }

  // createMany returns no ids, so each chunk's ids are read back through the
  // (accountId, externalId) unique key to attach the search tokens.
  let imported = 0;
  for (let start = 0; start < pending.length; start += INSERT_CHUNK) {
    const chunk = pending.slice(start, start + INSERT_CHUNK);
    await db.transaction.createMany({ data: chunk.map((p) => p.data) });
    const created = await db.transaction.findMany({
      where: { accountId: target.accountId, externalId: { in: chunk.map((p) => p.externalId) } },
      select: { id: true, externalId: true },
    });
    const idOf = new Map(created.map((c) => [c.externalId, c.id]));
    await db.transactionSearchToken.createMany({
      data: chunk.flatMap((p) =>
        p.tokens.map((tokenHash) => ({ transactionId: idOf.get(p.externalId)!, tokenHash })),
      ),
    });
    imported += chunk.length;
    await db.importBatch.update({
      where: { id: target.batchId },
      data: { importedRows: (target.progressOffset ?? 0) + imported },
    });
  }
  const hitRuleIds = pending.flatMap((p) => (p.ruleId ? [p.ruleId] : []));
  return { imported, skipped, total: rows.length, hitRuleIds };
}

function countHits(ruleIds: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ruleIds) out[id] = (out[id] ?? 0) + 1;
  return out;
}

// Finalizes an ImportBatch after inserts: sets COMPLETED + counters, audit-logs.
// Rule hits commit with the status so a rolled-back commit can't count them twice.
// A commit that imports nothing fails, so no empty, undoable batch lands in the history.
export async function finalizeBatch(
  batchId: string,
  totals: InsertTotals,
  actor: { id: string },
  accountIds: string[],
): Promise<CommitSummary> {
  if (totals.imported === 0) throw new ImportAccessError("NOTHING_TO_IMPORT");
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
        metadata: {
          ...trimBatchMetadata(metadata, accountIds),
          ...(totals.hitRuleIds.length ? { ruleHits: countHits(totals.hitRuleIds) } : {}),
        },
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
