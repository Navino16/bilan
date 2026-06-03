import { db } from "@/server/db";
import { computeExternalId } from "@/server/services/transactions/secure-fields";
import { suggestMany } from "@/server/services/categorization";
import { deriveType } from "./derive-type";
import type { NormalizedRow, PreviewRow } from "./types";

export type PreviewResult = {
  rows: PreviewRow[]; // ALL rows, enriched (the preview is editable, so every row is shown)
  totalRows: number;
  duplicateCount: number; // over ALL rows: already present in the destination account
  autoCategorizedCount: number; // over ALL rows: a rule matched
};

// Enriches parsed rows for the import preview against a destination account:
// per-row externalId + type + suggested category + duplicate flag, plus
// whole-set counts. `(accountId, externalId)` existence drives the duplicate
// flag; suggestions are matched in one rules-load via suggestMany.
export async function buildPreview(
  accountId: string,
  rows: NormalizedRow[],
  userId: string,
): Promise<PreviewResult> {
  const externalIds = rows.map((r) => computeExternalId(r.date, r.amount, r.rawLabel));
  const existing = externalIds.length
    ? await db.transaction.findMany({
        where: { accountId, externalId: { in: externalIds } },
        select: { externalId: true },
      })
    : [];
  const dupSet = new Set(existing.map((e) => e.externalId));
  const suggestions = await suggestMany(
    rows.map((r) => r.rawLabel),
    { userId },
  );

  let duplicateCount = 0;
  let autoCategorizedCount = 0;
  for (let i = 0; i < rows.length; i++) {
    if (dupSet.has(externalIds[i])) duplicateCount++;
    if (suggestions[i].categoryId) autoCategorizedCount++;
  }

  const previewRows: PreviewRow[] = rows.map((r, i) => ({
    externalId: externalIds[i],
    date: r.date.toISOString(),
    amount: r.amount,
    rawLabel: r.rawLabel,
    type: deriveType(r.rawLabel),
    suggestedCategoryId: suggestions[i].categoryId,
    isDuplicate: dupSet.has(externalIds[i]),
  }));

  return {
    rows: previewRows,
    totalRows: rows.length,
    duplicateCount,
    autoCategorizedCount,
  };
}
