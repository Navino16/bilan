import { z } from "zod";
import { parseAmount } from "@/lib/amount";

export const TRANSACTION_TYPES = [
  "CARD",
  "TRANSFER",
  "DIRECT_DEBIT",
  "CHEQUE",
  "ATM",
  "OTHER",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const transactionInputSchema = z.object({
  accountId: z.string().min(1),
  date: z.coerce.date(),
  // Amount in clear (Decimal(12,2)); accepts a number or a "12,34"/"12.34" string.
  amount: z
    .union([z.string(), z.number()])
    .transform((v) => {
      const n = parseAmount(v);
      return Math.round(n * 100) / 100;
    })
    .refine((n) => Number.isFinite(n) && Math.abs(n) < 1e10, { message: "Invalid amount" }),
  type: z.enum(TRANSACTION_TYPES),
  label: z.string().trim().min(1).max(200),
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
