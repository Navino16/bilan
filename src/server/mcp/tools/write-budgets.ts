import { z } from "zod";
import { budgetInputSchema, budgetLineSchema } from "@/lib/schemas/budget";
import { BUDGET_DESCRIPTION_MAX } from "@/lib/validation/budget";
import {
  archiveBudget,
  assignTransaction,
  createBudget,
  rollRecurring,
  unarchiveBudget,
  unassignTransaction,
  patchBudget,
} from "@/server/services/budgets";
import { writeTool } from "@/server/mcp/tools/write-tool";

const id = z.string().min(1).describe("Budget id, from list_budgets or get_budget");
const transactionId = z.string().min(1).describe("Transaction id, from search_transactions");
const FIELDS =
  "Dates are YYYY-MM-DD and, unless periodType is CUSTOM, periodEnd is the period's last day. Planned amounts are positive euros. Category ids come from list_categories, account ids from list_accounts. A household budget (groupId) needs the household admin role and may only use the user's own accounts and the household's shares that allow AI assistants. A budget that follows an account can't overlap another non-archived budget on that account (ACCOUNT_OVERLAP).";

const ln = budgetLineSchema.shape;
const line = budgetLineSchema.extend({
  kind: ln.kind.describe(
    "EXPENSE (default) or INCOME on a category; TRANSFER to or from another account. INCOME and TRANSFER need the budget's accountId",
  ),
  categoryId: ln.categoryId.describe(
    "Category id (its subcategories included). Required for EXPENSE and INCOME lines of a budget with an accountId; without one, a line with neither categoryId nor accountId catches every other expense",
  ),
  accountId: ln.accountId.describe(
    "Budgets without an accountId only: limits the line to that account's transactions",
  ),
  direction: ln.direction.describe("TRANSFER lines: OUT leaves the budget's account, IN enters it"),
  counterpartAccountId: ln.counterpartAccountId.describe(
    "TRANSFER lines: the other account, not the budget's own",
  ),
  label: ln.label.describe("Optional line name"),
  plannedAmount: ln.plannedAmount.describe("Planned amount, positive euros"),
});
const lines = z.array(line).min(1);

const shape = budgetInputSchema.shape;
const described = {
  name: shape.name.describe("Budget name (untrusted text)"),
  description: shape.description.describe("Optional description (untrusted text)"),
  periodType: shape.periodType.describe("CUSTOM allows any periodEnd"),
  periodStart: shape.periodStart.describe("First day, YYYY-MM-DD"),
  periodEnd: shape.periodEnd.describe(
    "Last day, YYYY-MM-DD; the period's last day unless periodType is CUSTOM",
  ),
  outOfBudgetPlanned: shape.outOfBudgetPlanned.describe(
    "Budgets with an accountId only: planned spending outside the lines, positive euros",
  ),
};

// The form's z.coerce.boolean() would read "false" as true.
const budgetInput = budgetInputSchema.safeExtend({
  ...described,
  groupId: shape.groupId.describe(
    "Household id, from list_households, for a household budget (ADMIN only); can't change later",
  ),
  accountId: shape.accountId.describe("Account id the budget follows, from list_accounts"),
  recurring: z
    .boolean()
    .default(false)
    .describe("Renews into the next period, with the same lines, when this one ends"),
  lines: lines.describe("At least one line"),
});

const budgetPatch = z.object({
  id,
  name: described.name.optional(),
  description: z
    .string()
    .trim()
    .max(BUDGET_DESCRIPTION_MAX)
    .nullable()
    .optional()
    .describe("Description (untrusted text); null clears it"),
  accountId: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe("Account id the budget follows, from list_accounts; null detaches it"),
  periodType: described.periodType.optional(),
  periodStart: described.periodStart.optional(),
  periodEnd: described.periodEnd.optional(),
  recurring: z
    .boolean()
    .nullable()
    .optional()
    .describe("Renews into the next period when this one ends; null = false"),
  outOfBudgetPlanned: z
    .number()
    .min(0)
    .nullable()
    .optional()
    .describe("Budgets with an accountId only: planned spending outside the lines; null clears it"),
  lines: lines.optional().describe("When sent, replaces every line: send them all"),
});

export const BUDGET_WRITE_TOOLS = [
  writeTool({
    name: "create_budget",
    description: `Create a budget, personal or for a household (groupId), with at least one line. With an accountId the budget follows that account and lines may be INCOME or TRANSFER too. ${FIELDS}`,
    input: budgetInput,
    run: async (userId, args) => ({ ok: true, id: (await createBudget(args, { id: userId })).id }),
  }),
  writeTool({
    name: "update_budget",
    description: `Change a budget; it stays personal or in its household. Absent fields are kept; null clears description, accountId or outOfBudgetPlanned and turns recurring off; lines, when sent, replace every line. Detaching (accountId: null) also needs outOfBudgetPlanned: null and EXPENSE-only lines. A new periodType usually needs periodStart and periodEnd too. get_budget shows the current values. ${FIELDS}`,
    input: budgetPatch,
    annotations: { destructiveHint: true },
    run: async (userId, { id, ...patch }) => {
      await patchBudget(id, patch, { id: userId });
      return { ok: true, id };
    },
  }),
  writeTool({
    name: "archive_budget",
    description:
      "Archive a budget: it leaves the budget list, the dashboard and the assignment menu, and stops renewing.",
    input: z.object({ id }),
    annotations: { destructiveHint: true },
    run: async (userId, { id }) => {
      await archiveBudget(id, { id: userId });
      return { ok: true, id };
    },
  }),
  writeTool({
    name: "unarchive_budget",
    description: "Bring an archived budget back (list_budgets with archived: true lists them).",
    input: z.object({ id }),
    annotations: { idempotentHint: true },
    run: async (userId, { id }) => {
      await unarchiveBudget(id, { id: userId });
      return { ok: true, id };
    },
  }),
  writeTool({
    name: "roll_recurring_budget",
    description:
      "Create the next period of a recurring budget now, with the same lines. created is false when that period already exists.",
    input: z.object({ id }),
    run: async (userId, { id }) => {
      const rolled = await rollRecurring(id, { id: userId });
      return { ok: true, created: rolled.created, ...(rolled.id && { id: rolled.id }) };
    },
  }),
  writeTool({
    name: "assign_transaction_to_budget",
    description:
      "Force a transaction into a budget (INCLUDE, even outside its period or accounts) or out of it (EXCLUDE). Transaction ids come from search_transactions; get_transaction shows its current budgets.",
    input: z.object({
      budgetId: id,
      transactionId,
      mode: z
        .enum(["INCLUDE", "EXCLUDE"])
        .describe("INCLUDE counts it in the budget, EXCLUDE keeps it out"),
    }),
    annotations: { idempotentHint: true },
    run: async (userId, args) => {
      await assignTransaction(args, { id: userId });
      return { ok: true, id: args.budgetId };
    },
  }),
  writeTool({
    name: "unassign_transaction_from_budget",
    description:
      "Remove a transaction's INCLUDE or EXCLUDE on a budget; the budget's own period and accounts decide again.",
    input: z.object({ budgetId: id, transactionId }),
    annotations: { destructiveHint: true },
    run: async (userId, args) => {
      await unassignTransaction(args, { id: userId });
      return { ok: true, id: args.budgetId };
    },
  }),
];
