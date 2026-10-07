import { db } from "@/server/db";
import { computeExternalIds } from "@/server/services/transactions/secure-fields";
import { suggestMany } from "@/server/services/categorization";
import { deriveType } from "./derive-type";
import type { NormalizedRow, PreviewRow } from "./types";

export const PREVIEW_PAGE_SIZE = 50;

export type PreviewResult = {
  rows: PreviewRow[]; // one page of enriched rows
  page: number;
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
  page = 0,
): Promise<PreviewResult> {
  const externalIds = computeExternalIds(rows);
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

  const lastPage = Math.max(0, Math.ceil(rows.length / PREVIEW_PAGE_SIZE) - 1);
  const current = Math.min(Math.max(0, Math.trunc(page) || 0), lastPage);
  const start = current * PREVIEW_PAGE_SIZE;
  const previewRows: PreviewRow[] = rows.slice(start, start + PREVIEW_PAGE_SIZE).map((r, j) => ({
    externalId: externalIds[start + j],
    date: r.date.toISOString(),
    amount: r.amount,
    rawLabel: r.rawLabel,
    type: r.type ?? deriveType(r.rawLabel),
    suggestedCategoryId: suggestions[start + j].categoryId,
    isDuplicate: dupSet.has(externalIds[start + j]),
  }));

  return {
    rows: previewRows,
    page: current,
    totalRows: rows.length,
    duplicateCount,
    autoCategorizedCount,
  };
}
