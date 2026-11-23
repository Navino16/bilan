import type { TransactionInput } from "@/lib/schemas/transaction";
import type { DateOrder } from "@/lib/validation/import";
import type { DecimalMark, RejectedRow } from "./csv-parse";
import type { RuleSummary } from "@/server/services/categorization";

type TxType = TransactionInput["type"];

// One bank movement after source-specific parsing, before encryption/insert.
// Shared by the CSV (4.2) and PDF (4.3b) pipelines.
export type NormalizedRow = {
  date: Date;
  amount: number; // signed: negative = expense, positive = income
  rawLabel: string;
  type?: TxType; // from a mapped "Type" column; otherwise derived from the label
  note?: string; // OFX MEMO when it adds to the NAME label
};

// A statement parses into one or more products (e.g. Revolut bundles a current
// account + a vault in one PDF). Each is mapped to a target account at commit.
export type ParsedProduct = { key: string; rows: NormalizedRow[] };

// CSV column mapping: either a single signed `amount` column, or a
// `debit`/`credit` pair (French bank exports). `type` is optional. `decimal` is
// the amounts' decimal mark: always set on a previewed mapping (#187), like
// `dateOrder` (detected from the dates unless set, #245).
export type CsvMapping = {
  date: string;
  label: string;
  amount?: string;
  debit?: string;
  credit?: string;
  type?: string;
  decimal?: DecimalMark;
  dateOrder?: DateOrder;
};

export type ResolvedCsvMapping = CsvMapping & { decimal: DecimalMark };

// Enriched row shown in the import preview (date serialized to ISO over the wire).
// `externalId` is the stable dedup key; the client uses it to key per-row edits
// (category override / exclusion) sent back at commit. `probableOf` is the label of the
// existing transaction this row probably duplicates (same day + amount, no key match).
// `rule` is the rule behind `suggestedCategoryId`, so the preview can offer to retarget it.
export type PreviewRow = {
  externalId: string;
  date: string;
  amount: number;
  rawLabel: string;
  type: TxType;
  suggestedCategoryId: string | null;
  rule: RuleSummary | null;
  isDuplicate: boolean;
  probableOf: string | null;
};

export type ImportPreview = {
  batchId: string;
  source: "CSV";
  filename: string | null;
  fileSizeBytes: number | null;
  headers: string[];
  mapping: CsvMapping;
  totalRows: number;
  duplicateCount: number;
  probableCount: number;
  viewRows: number; // rows the pages walk: the whole file, or the ones the filter keeps
  autoCategorizedCount: number;
  uncategorizedCount: number;
  rejectedCount: number; // rows of the file that couldn't be read with this mapping
  rejected: RejectedRow[]; // a few examples
  decimalGuessed: boolean; // no amount settled mapping.decimal: it came from a fallback
  dateOrderGuessed: boolean; // no date settled mapping.dateOrder, and some read differently
  preview: PreviewRow[]; // one page of enriched rows
  page: number;
  pageSize: number;
};

export type CommitSummary = {
  batchId: string;
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  rejectedRows?: number;
};
