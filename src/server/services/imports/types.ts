import type { TransactionInput } from "@/lib/validation/transaction";

type TxType = TransactionInput["type"];

// One bank movement after source-specific parsing, before encryption/insert.
// Shared by the CSV (4.2) and PDF (4.3b) pipelines.
export type NormalizedRow = {
  date: Date;
  amount: number; // signed: negative = expense, positive = income
  rawLabel: string;
};

// A statement parses into one or more products (e.g. Revolut bundles a current
// account + a vault in one PDF). Each is mapped to a target account at commit.
export type ParsedProduct = { key: string; rows: NormalizedRow[] };

// CSV column mapping: either a single signed `amount` column, or a
// `debit`/`credit` pair (French bank exports). `type` is optional.
export type CsvMapping = {
  date: string;
  label: string;
  amount?: string;
  debit?: string;
  credit?: string;
  type?: string;
};

// Enriched row shown in the import preview (date serialized to ISO over the wire).
// `externalId` is the stable dedup key; the client uses it to key per-row edits
// (category override / exclusion) sent back at commit.
export type PreviewRow = {
  externalId: string;
  date: string;
  amount: number;
  rawLabel: string;
  type: TxType;
  suggestedCategoryId: string | null;
  isDuplicate: boolean;
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
  autoCategorizedCount: number;
  preview: PreviewRow[]; // first 50 enriched rows
};

export type CommitSummary = {
  batchId: string;
  totalRows: number;
  importedRows: number;
  skippedRows: number;
};
