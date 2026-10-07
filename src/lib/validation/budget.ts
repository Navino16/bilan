import { z } from "zod";
import { parseAmount } from "@/lib/amount";

export const BUDGET_NAME_MAX = 80;
export const BUDGET_PERIOD_TYPES = ["WEEK", "MONTH", "QUARTER", "YEAR", "CUSTOM"] as const;
export type BudgetPeriodType = (typeof BUDGET_PERIOD_TYPES)[number];

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const budgetLineSchema = z.object({
  categoryId: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  accountId: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  label: z.preprocess(emptyToUndefined, z.string().trim().max(80).optional()),
  plannedAmount: z
    .union([z.string(), z.number()])
    .transform((v) => Math.round(parseAmount(v) * 100) / 100)
    .refine((n) => Number.isFinite(n) && n >= 0 && n < 1e10),
});

export const budgetInputSchema = z.object({
  name: z.string().trim().min(1).max(BUDGET_NAME_MAX),
  description: z.preprocess(emptyToUndefined, z.string().trim().max(500).optional()),
  groupId: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  periodType: z.enum(BUDGET_PERIOD_TYPES),
  periodStart: isoDay,
  periodEnd: isoDay,
  recurring: z.coerce.boolean().default(false),
  lines: z.array(budgetLineSchema).min(1),
});

export type BudgetInput = z.input<typeof budgetInputSchema>;
export type BudgetLineInput = z.input<typeof budgetLineSchema>;
