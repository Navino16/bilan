import { z } from "zod";
import { parseYearMonth } from "@/lib/assigned-month";
import { dayStart, isValidIsoDay } from "@/lib/period";
import { transactionInputSchema, transactionUpdateSchema } from "@/lib/schemas/transaction";
import {
  createManualTransaction,
  recategorizeTransaction,
  setTransactionMonth,
  updateTransaction,
} from "@/server/services/transactions";
import { writeTool } from "@/server/mcp/tools/write";

const AMOUNTS = "Amounts are in euros, negative for spending.";
const id = z.string().min(1).describe("Transaction id");

// z.coerce.date has no JSON Schema, so the date is advertised as a YYYY-MM-DD string.
export const createTransactionInput = transactionInputSchema.omit({ rawLabel: true }).extend({
  date: z
    .string()
    .refine(isValidIsoDay, { message: "DATE_INVALID" })
    .transform(dayStart)
    .describe("YYYY-MM-DD"),
});

// The service re-parses its input, so the date and note stay untransformed here.
const updateTransactionInput = z.object({
  id,
  label: transactionUpdateSchema.shape.label,
  note: z.string().trim().max(1000).optional().describe("Blank or absent clears the note"),
  date: z
    .string()
    .refine(isValidIsoDay, { message: "DATE_INVALID" })
    .optional()
    .describe("YYYY-MM-DD"),
  amount: transactionUpdateSchema.shape.amount,
  type: transactionUpdateSchema.shape.type,
});

export const TRANSACTION_WRITE_TOOLS = [
  writeTool({
    name: "create_transaction",
    description: `Add a manual transaction to an account the user can write. ${AMOUNTS} When no category is given, the user's categorization rules pick one.`,
    input: createTransactionInput,
    run: async (userId, args) => ({
      ok: true,
      id: (await createManualTransaction(args, { id: userId })).id,
    }),
  }),
  writeTool({
    name: "update_transaction",
    description: `Edit a transaction's label, note, date, amount or type; absent date, amount and type stay unchanged. ${AMOUNTS}`,
    input: updateTransactionInput,
    run: async (userId, { id, ...fields }) => {
      await updateTransaction(id, fields, { id: userId });
      return { ok: true, id };
    },
  }),
  writeTool({
    name: "recategorize_transaction",
    description: "Set a transaction's category, or remove it with a null categoryId.",
    input: z.object({ id, categoryId: z.string().min(1).nullable() }),
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
