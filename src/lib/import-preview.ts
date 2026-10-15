import type { CSV_FIELDS } from "@/lib/validation/import";

type CsvField = (typeof CSV_FIELDS)[number];

// Category a preview row will be committed with, mirroring insertRows (commit.ts):
// a per-row pick wins, else the rule suggestion only while auto-categorize is on.
// "" = Sans catégorie.
export function previewCategoryId(
  row: { externalId: string; suggestedCategoryId: string | null },
  overrides: Record<string, string>,
  autoCategorize: boolean,
): string {
  return overrides[row.externalId] ?? (autoCategorize ? row.suggestedCategoryId : null) ?? "";
}

const REJECT_FIELDS: Record<string, readonly CsvField[]> = {
  DATE: ["date"],
  AMOUNT: ["amount", "debit", "credit"],
  AMOUNT_RANGE: ["amount", "debit", "credit"],
  LABEL: ["label"],
};

// CSV fields whose column made the parser reject a sampled row (RejectReason, csv-parse.ts).
export function rejectedFields(rejected: readonly { reason: string }[] | undefined): Set<CsvField> {
  return new Set((rejected ?? []).flatMap((r) => REJECT_FIELDS[r.reason] ?? []));
}
