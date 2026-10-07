import { z } from "zod";

export const CSV_MAX_BYTES = 5 * 1024 * 1024;
export const PDF_MAX_BYTES = 10 * 1024 * 1024;

export const CSV_FIELDS = ["date", "label", "amount", "debit", "credit", "type"] as const;

// Mapping submitted at commit time. `date` + `label` always required; either
// `amount`, or at least one of `debit`/`credit`.
export const csvMappingSchema = z
  .object({
    date: z.string().min(1),
    label: z.string().min(1),
    amount: z.string().trim().optional(),
    debit: z.string().trim().optional(),
    credit: z.string().trim().optional(),
    type: z.string().trim().optional(),
  })
  .refine((m) => Boolean(m.amount || m.debit || m.credit), {
    message: "An amount, debit, or credit column is required",
  });

export type CsvMappingInput = z.input<typeof csvMappingSchema>;
