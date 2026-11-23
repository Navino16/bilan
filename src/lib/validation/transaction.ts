import { AMOUNT_ERRORS } from "@/lib/amount";

export const TRANSACTION_TYPES = [
  "CARD",
  "TRANSFER",
  "DIRECT_DEBIT",
  "CHEQUE",
  "ATM",
  "OTHER",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_LABEL_MAX = 200;
export const TRANSACTION_INPUT_ERRORS = [
  ...AMOUNT_ERRORS,
  "AMOUNT_ZERO",
  "LABEL_REQUIRED",
  "LABEL_TOO_LONG",
];

export const TRANSACTION_UPDATE_ERRORS = [...TRANSACTION_INPUT_ERRORS, "DATE_INVALID"];
