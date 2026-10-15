import { z } from "zod";

export const CSV_MAX_BYTES = 5 * 1024 * 1024;
export const PDF_MAX_BYTES = 10 * 1024 * 1024;

export const CSV_FIELDS = ["date", "label", "amount", "debit", "credit", "type"] as const;

export const DECIMAL_MARKS = [",", "."] as const;
export type DecimalMark = (typeof DECIMAL_MARKS)[number];

// Day/month order of slashed or dotted dates; ISO dates are never reordered.
export const DATE_ORDERS = ["DMY", "MDY"] as const;
export type DateOrder = (typeof DATE_ORDERS)[number];
export const DEFAULT_DATE_ORDER: DateOrder = "DMY";

const hasAmount = (m: { amount?: string; debit?: string; credit?: string }) =>
  Boolean(m.amount || m.debit || m.credit);
const amountMessage = { message: "An amount, debit, or credit column is required" };

// `date` + `label` always required; either `amount`, or at least one of
// `debit`/`credit`. Without `decimal`, the preview detects it (#187).
const mappingObject = z.object({
  date: z.string().min(1),
  label: z.string().min(1),
  amount: z.string().trim().optional(),
  debit: z.string().trim().optional(),
  credit: z.string().trim().optional(),
  type: z.string().trim().optional(),
  decimal: z.enum(DECIMAL_MARKS).optional(),
  dateOrder: z.enum(DATE_ORDERS).optional(),
});

export const csvMappingSchema = mappingObject.refine(hasAmount, amountMessage);

// A commit imports with the previewed decimal mark and date order, never a fresh guess (#187).
export const csvCommitMappingSchema = mappingObject
  .extend({ decimal: z.enum(DECIMAL_MARKS), dateOrder: z.enum(DATE_ORDERS) })
  .refine(hasAmount, amountMessage);

export type CsvMappingInput = z.input<typeof csvMappingSchema>;
