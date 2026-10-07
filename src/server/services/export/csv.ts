import Papa from "papaparse";
import type { Locale } from "@/i18n/config";

export type CsvRow = {
  date: string;
  amount: number;
  type: string;
  label: string;
  accountName: string;
  categoryName: string | null;
};

type CsvDialect = { delimiter: string; decimal: string; headers: string[] };

// Matches the list separator and decimal mark Excel uses for each locale, so the
// file opens in columns on a double-click (#171).
const DIALECTS: Record<Locale, CsvDialect> = {
  fr: {
    delimiter: ";",
    decimal: ",",
    headers: ["date", "montant", "type", "libellé", "compte", "catégorie"],
  },
  en: {
    delimiter: ",",
    decimal: ".",
    headers: ["date", "amount", "type", "label", "account", "category"],
  },
};

// Excel only reads a CSV as UTF-8 when it starts with a BOM.
const UTF8_BOM = "\uFEFF";

// Neutralize spreadsheet formula injection: a value beginning with =, +, -, @
// (or a leading tab/CR, which some parsers strip to reveal a formula char) is
// prefixed with a single quote so Excel/LibreOffice treat it as text, never a
// formula. Papa.unparse only handles delimiter/quote/newline escaping, not this.
function sanitizeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function formatAmount(amount: number, decimal: string): string {
  return amount.toFixed(2).replace(".", decimal);
}

// Pure: rows → RFC-4180 CSV in the locale's dialect. No DB, no decryption (callers
// pass already-decrypted, display-ready rows).
export function transactionsToCsv(rows: CsvRow[], locale: Locale): string {
  const { delimiter, decimal, headers } = DIALECTS[locale];
  const body = Papa.unparse(
    {
      fields: headers,
      data: rows.map((r) => [
        r.date,
        formatAmount(r.amount, decimal),
        r.type,
        sanitizeCell(r.label),
        sanitizeCell(r.accountName),
        sanitizeCell(r.categoryName ?? ""),
      ]),
    },
    { newline: "\n", delimiter },
  );
  return UTF8_BOM + body;
}
