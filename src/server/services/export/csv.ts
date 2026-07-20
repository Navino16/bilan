import Papa from "papaparse";

export type CsvRow = {
  date: string;
  amount: number;
  type: string;
  label: string;
  accountName: string;
  categoryName: string | null;
};

// Neutralize spreadsheet formula injection: a value beginning with =, +, -, @
// (or a leading tab/CR, which some parsers strip to reveal a formula char) is
// prefixed with a single quote so Excel/LibreOffice treat it as text, never a
// formula. Papa.unparse only handles delimiter/quote/newline escaping, not this.
function sanitizeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

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
        sanitizeCell(r.label),
        sanitizeCell(r.accountName),
        sanitizeCell(r.categoryName ?? ""),
      ]),
    },
    { newline: "\n" },
  );
}
