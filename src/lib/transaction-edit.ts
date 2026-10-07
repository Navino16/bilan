// "full": every field is editable. "text": label and note only — an imported row
// mirrors the bank statement (its dedup key hashes date/amount/raw label) and an
// archived account's figures are closed.
export type EditScope = "full" | "text";

export function editScope(row: { imported: boolean; archived: boolean }): EditScope {
  return row.imported || row.archived ? "text" : "full";
}
