import { z } from "zod";
import {
  BUDGET_DESCRIPTION_MAX,
  BUDGET_LINE_LABEL_MAX,
  BUDGET_NAME_MAX,
  BUDGET_PERIOD_TYPES,
} from "@/lib/validation/budget";
import { amountSchema } from "./amount";

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const budgetLineSchema = z.object({
  categoryId: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  accountId: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  label: z.preprocess(emptyToUndefined, z.string().trim().max(BUDGET_LINE_LABEL_MAX).optional()),
  plannedAmount: amountSchema.refine((n) => n >= 0),
});

export const budgetInputSchema = z.object({
  name: z.string().trim().min(1).max(BUDGET_NAME_MAX),
  description: z.preprocess(
    emptyToUndefined,
    z.string().trim().max(BUDGET_DESCRIPTION_MAX).optional(),
  ),
  groupId: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  periodType: z.enum(BUDGET_PERIOD_TYPES),
  periodStart: isoDay,
  periodEnd: isoDay,
  recurring: z.coerce.boolean().default(false),
  lines: z.array(budgetLineSchema).min(1),
});

export type BudgetInput = z.input<typeof budgetInputSchema>;
export type BudgetLineInput = z.input<typeof budgetLineSchema>;
