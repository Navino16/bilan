import { db } from "@/server/db";
import { computeExternalIds } from "@/server/services/transactions/secure-fields";
import { suggestMany } from "@/server/services/categorization";
import { deriveType } from "./derive-type";
import { findProbableDuplicates } from "./probable";
import type { NormalizedRow, PreviewRow } from "./types";

export const PREVIEW_PAGE_SIZE = 50;

export type PreviewResult = {
  rows: PreviewRow[]; // one page of enriched rows
  page: number;
  totalRows: number;
  viewRows: number; // rows the pages walk: the whole file, or the probable ones with probableOnly
  duplicateCount: number; // over ALL rows: already present in the destination account
  probableCount: number; // over ALL rows: see findProbableDuplicates
  autoCategorizedCount: number; // over ALL rows: a rule matched
};

// Enriches parsed rows for the import preview against a destination account:
// per-row externalId + type + suggested category + duplicate / probable-duplicate flags,
// plus whole-set counts. `(accountId, externalId)` existence drives the duplicate
// flag; suggestions are matched in one rules-load via suggestMany.
export async function buildPreview(
  accountId: string,
  rows: NormalizedRow[],
  userId: string,
  page = 0,
  opts: { probableOnly?: boolean } = {},
): Promise<PreviewResult> {
  const externalIds = computeExternalIds(rows);
  const existing = externalIds.length
    ? await db.transaction.findMany({
        where: { accountId, externalId: { in: externalIds } },
        select: { externalId: true },
      })
    : [];
  const dupSet = new Set(existing.map((e) => e.externalId!));
  const [probable, suggestions] = await Promise.all([
    findProbableDuplicates(accountId, rows, externalIds, dupSet),
    suggestMany(
      rows.map((r) => r.rawLabel),
      { userId },
    ),
  ]);

  let duplicateCount = 0;
  let autoCategorizedCount = 0;
  for (let i = 0; i < rows.length; i++) {
    if (dupSet.has(externalIds[i])) duplicateCount++;
    if (suggestions[i].categoryId) autoCategorizedCount++;
  }

  const view = opts.probableOnly ? [...probable.keys()] : null;
  const viewRows = view ? view.length : rows.length;
  const lastPage = Math.max(0, Math.ceil(viewRows / PREVIEW_PAGE_SIZE) - 1);
  const current = Math.min(Math.max(0, Math.trunc(page) || 0), lastPage);
  const start = current * PREVIEW_PAGE_SIZE;
  const end = Math.min(start + PREVIEW_PAGE_SIZE, viewRows);
  const previewRows: PreviewRow[] = [];
  for (let k = start; k < end; k++) {
    const i = view ? view[k] : k;
    const r = rows[i];
    previewRows.push({
      externalId: externalIds[i],
      date: r.date.toISOString(),
      amount: r.amount,
      rawLabel: r.rawLabel,
      type: r.type ?? deriveType(r.rawLabel),
      suggestedCategoryId: suggestions[i].categoryId,
      isDuplicate: dupSet.has(externalIds[i]),
      probableOf: probable.get(i) ?? null,
    });
  }

  return {
    rows: previewRows,
    page: current,
    totalRows: rows.length,
    viewRows,
    duplicateCount,
    probableCount: probable.size,
    autoCategorizedCount,
  };
}
