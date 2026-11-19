import { z } from "zod";
import { budgetInputSchema } from "@/lib/schemas/budget";
import {
  archiveBudget,
  assignTransaction,
  createBudget,
  rollRecurring,
  unarchiveBudget,
  unassignTransaction,
  updateBudget,
} from "@/server/services/budgets";
import { writeTool } from "@/server/mcp/tools/write-tool";

const id = z.string().min(1).describe("Budget id, from list_budgets or get_budget");
const transactionId = z.string().min(1).describe("Transaction id");
const FIELDS =
  "Dates are YYYY-MM-DD and, unless periodType is CUSTOM, periodEnd is the period's last day. Planned amounts are positive euros. Category ids come from list_categories, account ids from list_accounts. A household budget (groupId) needs the household admin role and may only use the user's own accounts and the household's shares that allow AI assistants.";

// The form's z.coerce.boolean() would read "false" as true.
const budgetInput = budgetInputSchema.safeExtend({ recurring: z.boolean().default(false) });

export const BUDGET_WRITE_TOOLS = [
  writeTool({
    name: "create_budget",
    description: `Create a budget, personal or for a household (groupId), with at least one line. With an accountId the budget follows that account and lines may be INCOME or TRANSFER too. ${FIELDS}`,
    input: budgetInput,
    run: async (userId, args) => ({ ok: true, id: (await createBudget(args, { id: userId })).id }),
  }),
  writeTool({
    name: "update_budget",
    description: `Replace a budget's fields and lines; it stays personal or in its household (groupId is ignored). Send every current field from get_budget: absent optional fields (description, accountId, outOfBudgetPlanned) are cleared and recurring becomes false. ${FIELDS}`,
    input: budgetInput.safeExtend({ id }),
    annotations: { destructiveHint: true },
    run: async (userId, { id, ...input }) => {
      await updateBudget(id, input, { id: userId });
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
    input: z.object({ budgetId: id, transactionId, mode: z.enum(["INCLUDE", "EXCLUDE"]) }),
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
