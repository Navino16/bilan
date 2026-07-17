import Papa from "papaparse";

export type CsvRow = {
  date: string;
  amount: number;
  type: string;
  label: string;
  accountName: string;
  categoryName: string | null;
};

// Pure: rows → RFC-4180 CSV with a stable header. No DB, no decryption (callers
// pass already-decrypted, display-ready rows).
export function transactionsToCsv(rows: CsvRow[]): string {
  return Papa.unparse(
    {
      fields: ["date", "amount", "type", "label", "account", "category"],
      data: rows.map((r) => [
        r.date,
        r.amount,
        r.type,
        r.label,
        r.accountName,
        r.categoryName ?? "",
      ]),
    },
    { newline: "\n" },
  );
}
