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
