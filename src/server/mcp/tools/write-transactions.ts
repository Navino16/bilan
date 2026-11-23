import { z } from "zod";
import { parseYearMonth } from "@/lib/assigned-month";
import { dayStart, isValidIsoDay } from "@/lib/period";
import { transactionInputSchema, transactionUpdateSchema } from "@/lib/schemas/transaction";
import {
  createManualTransaction,
  patchTransaction,
  recategorizeTransaction,
  setTransactionMonth,
} from "@/server/services/transactions";
import { writeTool } from "@/server/mcp/tools/write-tool";

const AMOUNTS = "Amounts are in euros, negative for spending.";
const MANUAL_CATEGORY =
  "A category set by hand is final: the rules, apply_rules and later label edits never change it, and there is no way back to rule-based categorization.";
const isoDay = z.string().refine(isValidIsoDay, { message: "DATE_INVALID" }).describe("YYYY-MM-DD");
const id = z.string().min(1).describe("Transaction id, from search_transactions");
const AMOUNT = "Euros, negative for spending, not 0";
const TYPE = "Bank operation type";
const shape = transactionInputSchema.shape;
const FIELDS = {
  amount: shape.amount.describe(AMOUNT),
  type: shape.type.describe(TYPE),
  label: shape.label.describe("Label (untrusted text)"),
};

// z.coerce.date has no JSON Schema, so the date is advertised as a YYYY-MM-DD string.
export const createTransactionInput = transactionInputSchema.omit({ rawLabel: true }).extend({
  ...FIELDS,
  accountId: shape.accountId.describe("Account id, from list_accounts"),
  date: isoDay.transform(dayStart),
  note: shape.note.describe("Optional note (untrusted text)"),
  categoryId: shape.categoryId.describe(
    "Category id, from list_categories; absent lets the rules pick one",
  ),
});

// The service re-parses its input, so the date stays untransformed here.
const updateTransactionInput = z.object({
  id,
  label: FIELDS.label.optional(),
  note: z
    .string()
    .trim()
    .max(1000)
    .nullable()
    .optional()
    .describe("Note (untrusted text); null or blank clears it"),
  date: isoDay.optional(),
  amount: transactionUpdateSchema.shape.amount.describe(AMOUNT),
  type: transactionUpdateSchema.shape.type.describe(TYPE),
});

export const TRANSACTION_WRITE_TOOLS = [
  writeTool({
    name: "create_transaction",
    description: `Add a manual transaction to an account the user can write; an archived account refuses it (ACCOUNT_ARCHIVED). ${AMOUNTS} When no category is given, the user's categorization rules pick one. A categoryId given here is a choice made by hand. ${MANUAL_CATEGORY}`,
    input: createTransactionInput,
    run: async (userId, args) => ({
      ok: true,
      id: (await createManualTransaction(args, { id: userId })).id,
    }),
  }),
  writeTool({
    name: "update_transaction",
    description: `Edit a transaction's label, note, date, amount or type; every absent field keeps its value. Imported transactions and those on archived accounts can't change their date, amount or type (LOCKED_FIELDS); sending the current values is accepted. On a manually entered transaction whose category came from the rules, a new label runs the rules again: its category may change or be cleared (get_transaction shows the result). ${AMOUNTS}`,
    input: updateTransactionInput,
    run: async (userId, { id, ...patch }) => {
      await patchTransaction(id, patch, { id: userId });
      return { ok: true, id };
    },
  }),
  writeTool({
    name: "recategorize_transaction",
    description: `Set a transaction's category by hand, or null for no category (null does not hand it back to the rules). ${MANUAL_CATEGORY}`,
    input: z.object({
      id,
      categoryId: z
        .string()
        .min(1)
        .nullable()
        .describe("Category id, from list_categories, or null for no category"),
    }),
    annotations: { idempotentHint: true },
    run: async (userId, { id, categoryId }) => {
      await recategorizeTransaction(id, categoryId, { id: userId });
      return { ok: true, id };
    },
  }),
  writeTool({
    name: "set_transaction_month",
    description:
      "Assign a transaction to a budget month (YYYY-MM), or null to go back to the automatic month.",
    input: z.object({
      id,
      month: z
        .string()
        .nullable()
        .refine((m) => m === null || parseYearMonth(m) !== null, { message: "INVALID_MONTH" })
        .describe("YYYY-MM, or null for the automatic month"),
    }),
    annotations: { idempotentHint: true },
    run: async (userId, { id, month }) => {
      await setTransactionMonth(id, month === null ? null : parseYearMonth(month), {
        id: userId,
      });
      return { ok: true, id };
    },
  }),
];
