import { z } from "zod";
import {
  BUDGET_DESCRIPTION_MAX,
  BUDGET_LINE_KINDS,
  BUDGET_LINE_LABEL_MAX,
  BUDGET_NAME_MAX,
  BUDGET_PERIOD_TYPES,
  TRANSFER_DIRECTIONS,
} from "@/lib/validation/budget";
import { amountSchema } from "./amount";

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalId = z.preprocess(emptyToUndefined, z.string().trim().optional());

export const budgetLineSchema = z.object({
  kind: z.enum(BUDGET_LINE_KINDS).default("EXPENSE"),
  categoryId: optionalId,
  accountId: optionalId,
  direction: z.preprocess(emptyToUndefined, z.enum(TRANSFER_DIRECTIONS).optional()),
  counterpartAccountId: optionalId,
  label: z.preprocess(emptyToUndefined, z.string().trim().max(BUDGET_LINE_LABEL_MAX).optional()),
  plannedAmount: amountSchema.refine((n) => n >= 0),
});

export const budgetInputSchema = z
  .object({
    name: z.string().trim().min(1).max(BUDGET_NAME_MAX),
    description: z.preprocess(
      emptyToUndefined,
      z.string().trim().max(BUDGET_DESCRIPTION_MAX).optional(),
    ),
    groupId: optionalId,
    accountId: optionalId,
    periodType: z.enum(BUDGET_PERIOD_TYPES),
    periodStart: isoDay,
    periodEnd: isoDay,
    recurring: z.coerce.boolean().default(false),
    outOfBudgetPlanned: z.preprocess(
      emptyToUndefined,
      amountSchema.refine((n) => n >= 0).optional(),
    ),
    lines: z.array(budgetLineSchema).min(1),
  })
  .superRefine((b, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    // Kinds, transfers and the margin only make sense on an account (design §B–D).
    if (!b.accountId) {
      if (b.outOfBudgetPlanned !== undefined) issue(["outOfBudgetPlanned"], "INVALID");
      b.lines.forEach((l, i) => l.kind !== "EXPENSE" && issue(["lines", i, "kind"], "INVALID"));
      return;
    }
    b.lines.forEach((l, i) => {
      if (l.kind !== "TRANSFER") {
        if (!l.categoryId) issue(["lines", i, "categoryId"], "REQUIRED");
        return;
      }
      if (l.categoryId) issue(["lines", i, "categoryId"], "INVALID");
      if (!l.direction) issue(["lines", i, "direction"], "REQUIRED");
      if (!l.counterpartAccountId) issue(["lines", i, "counterpartAccountId"], "REQUIRED");
      else if (l.counterpartAccountId === b.accountId)
        issue(["lines", i, "counterpartAccountId"], "INVALID");
    });
  });

export type BudgetInput = z.input<typeof budgetInputSchema>;
export type BudgetLineInput = z.input<typeof budgetLineSchema>;
