import { z } from "zod";
import { DATE_ORDERS, DECIMAL_MARKS } from "@/lib/validation/import";

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
