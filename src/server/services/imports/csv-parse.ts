import Papa from "papaparse";
import type { CsvMapping, NormalizedRow } from "./types";

export type RawRow = Record<string, string>;

// Parses a CSV string. Auto-detects the delimiter (`,` or `;`), trims headers,
// and returns string cells keyed by header.
export function parseCsv(text: string): { headers: string[]; rows: RawRow[] } {
  const result = Papa.parse<RawRow>(text.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  const headers = result.meta.fields?.map((f) => f.trim()) ?? [];
  return { headers, rows: result.data };
}

const DATE_HINTS = ["date", "date opération", "date operation", "date valeur"];
const LABEL_HINTS = ["libellé", "libelle", "label", "description", "nature", "détail", "detail"];
const AMOUNT_HINTS = ["montant", "amount", "valeur"];
const DEBIT_HINTS = ["débit", "debit", "retrait"];
const CREDIT_HINTS = ["crédit", "credit", "versement"];
const TYPE_HINTS = ["type", "mode", "opération", "operation"];

function pick(headers: string[], hints: string[]): string | undefined {
  const lower = headers.map((h) => h.toLowerCase());
  for (const hint of hints) {
    const i = lower.findIndex((h) => h === hint);
    if (i >= 0) return headers[i];
  }
  for (const hint of hints) {
    const i = lower.findIndex((h) => h.includes(hint));
    if (i >= 0) return headers[i];
  }
  return undefined;
}

// Best-effort column mapping from header names. The UI lets the user correct it.
export function detectMapping(headers: string[]): CsvMapping {
  const amount = pick(headers, AMOUNT_HINTS);
  return {
    date: pick(headers, DATE_HINTS) ?? headers[0] ?? "",
    label: pick(headers, LABEL_HINTS) ?? headers[1] ?? "",
    ...(amount ? { amount } : {}),
    debit: pick(headers, DEBIT_HINTS),
    credit: pick(headers, CREDIT_HINTS),
    type: pick(headers, TYPE_HINTS),
  };
}

// "1 234,56" / "42,90" / "-7.5" → number; "" / garbage → null.
export function normalizeAmount(raw: string): number | null {
  const s = raw.replace(/\s/g, "").replace(/ /g, "").replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Builds a UTC-midnight Date from calendar parts, rejecting impossible dates:
// `new Date("2026-02-31T…")` silently rolls over to 2026-03-03, so we verify the
// constructed date's fields round-trip back to the inputs.
export function utcDayFromParts(year: number, month: number, day: number): Date | null {
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return null;
  }
  return dt;
}

// dd/mm/yyyy or yyyy-mm-dd → UTC midnight Date; invalid/garbage → null.
export function normalizeDate(raw: string): Date | null {
  const s = raw.trim();
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (fr) return utcDayFromParts(Number(fr[3]), Number(fr[2]), Number(fr[1]));
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return utcDayFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  return null;
}

// Applies the mapping to raw rows, dropping any row whose date or amount is
// unparseable. A debit becomes negative, a credit positive; a single signed
// `amount` column is used as-is.
export function mapRows(rows: RawRow[], mapping: CsvMapping): NormalizedRow[] {
  const out: NormalizedRow[] = [];
  for (const row of rows) {
    const date = normalizeDate(row[mapping.date] ?? "");
    if (!date) continue;

    let amount: number | null = null;
    if (mapping.amount) {
      amount = normalizeAmount(row[mapping.amount] ?? "");
    } else {
      const debit = mapping.debit ? normalizeAmount(row[mapping.debit] ?? "") : null;
      const credit = mapping.credit ? normalizeAmount(row[mapping.credit] ?? "") : null;
      if (debit != null) amount = -Math.abs(debit);
      else if (credit != null) amount = Math.abs(credit);
    }
    if (amount == null) continue;

    const rawLabel = (row[mapping.label] ?? "").trim();
    if (!rawLabel) continue;

    out.push({ date, amount, rawLabel });
  }
  return out;
}
