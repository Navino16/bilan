import { z } from "zod";
import { AMOUNT_ERRORS } from "@/lib/amount";
import { dayStart, isValidIsoDay } from "@/lib/period";
import { amountSchema } from "./amount";

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
export const TRANSACTION_INPUT_ERRORS = [...AMOUNT_ERRORS, "AMOUNT_ZERO", "LABEL_TOO_LONG"];

export const transactionInputSchema = z.object({
  accountId: z.string().min(1),
  date: z.coerce.date(),
  // Amount in clear (Decimal(12,2)). Issue messages are the codes in TRANSACTION_INPUT_ERRORS.
  amount: amountSchema.refine((n) => n !== 0, { message: "AMOUNT_ZERO" }),
  type: z.enum(TRANSACTION_TYPES),
  label: z.string().trim().min(1).max(TRANSACTION_LABEL_MAX, { message: "LABEL_TOO_LONG" }),
  // rawLabel defaults to label for manual entry; imports pass the bank string.
  rawLabel: z.string().trim().max(300).optional(),
  note: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => (v ? v : undefined)),
  categoryId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export type TransactionInput = z.input<typeof transactionInputSchema>;

export const TRANSACTION_UPDATE_ERRORS = [...TRANSACTION_INPUT_ERRORS, "DATE_INVALID"];

// Absent date/amount/type are left unchanged; an absent or blank note clears it.
export const transactionUpdateSchema = z.object({
  label: transactionInputSchema.shape.label,
  note: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => v || null),
  date: z
    .string()
    .refine(isValidIsoDay, { message: "DATE_INVALID" })
    .transform(dayStart)
    .optional(),
  amount: transactionInputSchema.shape.amount.optional(),
  type: z.enum(TRANSACTION_TYPES).optional(),
});

export type TransactionUpdateInput = z.input<typeof transactionUpdateSchema>;
