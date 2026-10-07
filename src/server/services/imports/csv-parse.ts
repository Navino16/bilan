import Papa from "papaparse";
import type { CsvMapping, NormalizedRow } from "./types";

export type RawRow = Record<string, string>;

// Parses a CSV string. Auto-detects the delimiter (`,` or `;`), trims headers,
// and returns string cells keyed by header.
export function parseCsv(text: string): { headers: string[]; rows: RawRow[] } {
  // Empty lines are kept (and skipped by mapRows) so a row's index maps to its file line.
  const result = Papa.parse<RawRow>(text.trimEnd(), {
    header: true,
    skipEmptyLines: false,
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
const TYPE_HINTS = ["type", "mode"];
const TYPE_EXACT = ["opération", "operation"];

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
    type: pick(headers, TYPE_HINTS) ?? headers.find((h) => TYPE_EXACT.includes(h.toLowerCase())),
  };
}

// Decodes an uploaded CSV: UTF-16 when it starts with its BOM, UTF-8 when
// valid, else Windows-1252 (French bank exports are often Latin-1).
export function decodeCsv(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (view[0] === 0xff && view[1] === 0xfe) return new TextDecoder("utf-16le").decode(view);
  if (view[0] === 0xfe && view[1] === 0xff) return new TextDecoder("utf-16be").decode(view);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(view);
  } catch {
    return new TextDecoder("windows-1252").decode(view);
  }
}

// The DB stores amounts as Decimal(12,2).
export const MAX_ABS_AMOUNT = 9_999_999_999.99;

export type DecimalMark = "." | ",";

// The decimal mark of a whole amount column, when some value settles it: one
// holding both separators (the last is decimal), or a lone separator not
// followed by exactly 3 digits. Null when every value is ambiguous ("1.234").
export function inferDecimalMark(values: string[]): DecimalMark | null {
  for (const raw of values) {
    const s = raw.replace(/[^\d.,]/g, "");
    const last = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
    if (last < 0) continue;
    if (s.includes(".") && s.includes(",")) return s[last] as DecimalMark;
    const count = s.split(s[last]).length - 1;
    if (count === 1 && s.length - last - 1 !== 3) return s[last] as DecimalMark;
  }
  return null;
}

const THOUSANDS = /^\d{1,3}([.,]\d{3})+$/;

// "1 234,56" / "-12,34 €" / "(12,34)" / "12,34-" / "+15" → number; "" /
// garbage / several minus signs → null. `decimal` is the column's mark (see
// inferDecimalMark); without it, a lone separator before exactly 3 digits
// after a non-zero integer part ("1.234") is read as thousands.
export function normalizeAmount(raw: string, decimal: DecimalMark | null = null): number | null {
  let s = raw
    .replace(/\s/g, "")
    .replace(/€|EUR/gi, "")
    .replace(/\u2212/g, "-");
  if (s === "") return null;
  let negatives = 0;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) [negatives, s] = [negatives + 1, paren[1]];
  const trailing = /^(.*)-$/.exec(s);
  if (trailing) [negatives, s] = [negatives + 1, trailing[1]];
  const sign = /^([+-])(.*)$/.exec(s);
  if (sign) [negatives, s] = [negatives + (sign[1] === "-" ? 1 : 0), sign[2]];
  if (negatives > 1 || !/^\d[\d.,]*$/.test(s) || /[.,]$/.test(s)) return null;

  const dots = s.split(".").length - 1;
  const commas = s.split(",").length - 1;
  let mark: DecimalMark | null = null;
  if (dots && commas) {
    mark = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
  } else if (dots + commas > 0) {
    const sep: DecimalMark = dots ? "." : ",";
    const lone = dots + commas === 1;
    const looksThousands = THOUSANDS.test(s) && !/^0[.,]/.test(s);
    if (decimal ? sep === decimal : !(lone && looksThousands) && lone) mark = sep;
    else if (!looksThousands) return null;
  }
  if (mark && (mark === "." ? dots : commas) > 1) return null;
  const [intRaw, frac = ""] = mark
    ? [s.slice(0, s.lastIndexOf(mark)), s.slice(s.lastIndexOf(mark) + 1)]
    : [s];
  const intPart = intRaw.replace(/[.,]/g, "");
  if (mark && intRaw !== intPart && !THOUSANDS.test(intRaw)) return null;
  const n = Number(`${intPart}.${frac || "0"}`);
  if (!Number.isFinite(n)) return null;
  return negatives ? -n : n;
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

// Two-digit years up to next year are 20yy, the rest 19yy.
const TWO_DIGIT_PIVOT = (new Date().getUTCFullYear() % 100) + 1;

// d/m/yyyy, dd/mm/yy (→ 20yy or 19yy), dd.mm.yyyy, dd-mm-yyyy, yyyy-mm-dd, yyyy/mm/dd
// (an optional time after a space or "T" is ignored) → UTC midnight; else null.
export function normalizeDate(raw: string): Date | null {
  const s = raw.trim().replace(/[ T]\d{1,2}:\d{2}(:\d{2})?.*$/, "");
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (dmy) {
    const yy = Number(dmy[3]);
    const year = dmy[3].length === 4 ? yy : yy <= TWO_DIGIT_PIVOT ? 2000 + yy : 1900 + yy;
    return utcDayFromParts(year, Number(dmy[2]), Number(dmy[1]));
  }
  const ymd = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(s);
  if (ymd) return utcDayFromParts(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  return null;
}

const TYPE_VALUES: Array<{ re: RegExp; type: NonNullable<NormalizedRow["type"]> }> = [
  { re: /ch[èe]que|\bchq\b|cheque/i, type: "CHEQUE" },
  { re: /retrait|\bdab\b|\batm\b|withdrawal/i, type: "ATM" },
  { re: /pr[ée]l[èe]vement|\bprlv\b|direct.?debit|[ée]ch[ée]ance/i, type: "DIRECT_DEBIT" },
  { re: /virement|\bvir\b|transfer/i, type: "TRANSFER" },
  { re: /carte|\bcb\b|card/i, type: "CARD" },
];

// Maps a bank's "Type" cell ("Carte", "Prélèvement", "VIR"…) to a transaction type.
export function normalizeType(raw: string): NormalizedRow["type"] {
  const s = raw.trim();
  if (!s) return undefined;
  return TYPE_VALUES.find(({ re }) => re.test(s))?.type;
}

export type RejectReason = "DATE" | "AMOUNT" | "AMOUNT_RANGE" | "LABEL";
export type RejectedRow = { row: number; reason: RejectReason; value: string };

// Applies the mapping to raw rows. A debit becomes negative, a credit positive;
// a single signed `amount` column is used as-is. Unusable rows are reported in
// `rejected` with their line in the file; blank lines are skipped.
export function mapRows(
  rows: RawRow[],
  mapping: CsvMapping,
): { rows: NormalizedRow[]; rejected: RejectedRow[] } {
  const out: NormalizedRow[] = [];
  const rejected: RejectedRow[] = [];
  const cell = (row: RawRow, col: string | undefined) =>
    col && Object.hasOwn(row, col) ? (row[col] ?? "") : "";
  const reject = (row: number, reason: RejectReason, value: string) =>
    void rejected.push({ row, reason, value: value.slice(0, 60) });
  const amountMark = mapping.amount
    ? inferDecimalMark(rows.map((r) => cell(r, mapping.amount)))
    : inferDecimalMark(rows.flatMap((r) => [cell(r, mapping.debit), cell(r, mapping.credit)]));

  rows.forEach((row, i) => {
    if (Object.values(row).every((v) => !String(v ?? "").trim())) return;
    const position = i + 2; // file line: the header is line 1
    const rawDate = cell(row, mapping.date);
    const date = normalizeDate(rawDate);
    if (!date) return reject(position, "DATE", rawDate);

    let amount: number | null = null;
    let rawAmount = "";
    if (mapping.amount) {
      rawAmount = cell(row, mapping.amount);
      amount = normalizeAmount(rawAmount, amountMark);
    } else {
      const rawDebit = cell(row, mapping.debit);
      const rawCredit = cell(row, mapping.credit);
      rawAmount = [rawDebit, rawCredit].filter(Boolean).join(" / ");
      const debit = normalizeAmount(rawDebit, amountMark);
      const credit = normalizeAmount(rawCredit, amountMark);
      // A literal "0,00" in the unused column is treated as absent: many bank
      // CSVs fill the empty side with zero rather than leaving it blank, so we
      // pick whichever side carries a non-zero value.
      if (debit) amount = -Math.abs(debit);
      else if (credit) amount = Math.abs(credit);
      else if (debit === 0 || credit === 0) amount = 0;
    }
    if (amount == null) return reject(position, "AMOUNT", rawAmount);
    amount = Math.round(amount * 100) / 100;
    if (Math.abs(amount) > MAX_ABS_AMOUNT) return reject(position, "AMOUNT_RANGE", rawAmount);

    const rawLabel = cell(row, mapping.label).trim();
    if (!rawLabel) return reject(position, "LABEL", "");

    const typeCol =
      mapping.type && mapping.type !== mapping.label && mapping.type !== mapping.date
        ? mapping.type
        : undefined;
    const type = typeCol ? normalizeType(cell(row, typeCol)) : undefined;
    out.push({ date, amount, rawLabel, ...(type ? { type } : {}) });
  });
  return { rows: out, rejected };
}
