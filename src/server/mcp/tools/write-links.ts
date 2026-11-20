import { z } from "zod";
import {
  createLink,
  deleteLink,
  ignoreSuggestion,
  restoreSuggestion,
} from "@/server/services/links";
import { createOppositeTransaction } from "@/server/services/links/opposite";
import { writeTool } from "@/server/mcp/tools/write-tool";

const pairKey = z
  .string()
  .max(191)
  .refine((k) => k.includes("|"), { message: "INVALID_PAIR_KEY" })
  .describe("Pair key (the `key` field) from list_link_suggestions");

export const LINK_WRITE_TOOLS = [
  writeTool({
    name: "create_link",
    description:
      "Link 2 or more transactions together (a transfer, a refund). Every transaction must be on an account the user can write and not already linked.",
    input: z.object({
      transactionIds: z
        .array(z.string().min(1))
        .min(2)
        .max(50)
        .describe("Transaction ids, from search_transactions or list_link_suggestions"),
    }),
    run: async (userId, { transactionIds }) => ({
      ok: true,
      id: (await createLink({ transactionIds, userId })).id,
    }),
  }),
  writeTool({
    name: "create_opposite_transaction",
    description:
      "Create the other leg of a transfer the bank does not show: a mirror transaction on one of the user's own accounts, linked to the source. The source must not be linked yet, and the target must be another, non-archived account the user owns.",
    input: z.object({
      transactionId: z.string().min(1).describe("Source transaction id, from search_transactions"),
      targetAccountId: z
        .string()
        .min(1)
        .describe("Account id, from list_accounts: owned by the user, not the source's account"),
    }),
    run: async (userId, { transactionId, targetAccountId }) => ({
      ok: true,
      id: (await createOppositeTransaction({ transactionId, targetAccountId, userId })).id,
    }),
  }),
  writeTool({
    name: "delete_link",
    description:
      "Remove a link; its transactions are kept and become unlinked. A link made automatically also dismisses its pair, so it is neither suggested nor linked again; restore_link_suggestion brings the suggestion back.",
    input: z.object({
      linkId: z.string().min(1).describe("Link id: the linkId that get_transaction returns"),
    }),
    annotations: { destructiveHint: true },
    run: async (userId, { linkId }) => {
      await deleteLink(linkId, userId);
      return { ok: true, id: linkId };
    },
  }),
  writeTool({
    name: "ignore_link_suggestion",
    description:
      "Dismiss a suggested pair so it stops being suggested. The pairKey comes from list_link_suggestions; list_link_suggestions with ignored: true lists the dismissed pairs.",
    input: z.object({ pairKey }),
    annotations: { idempotentHint: true },
    run: async (userId, { pairKey }) => {
      await ignoreSuggestion(userId, pairKey);
      return { ok: true, id: pairKey };
    },
  }),
  writeTool({
    name: "restore_link_suggestion",
    description:
      "Bring back a dismissed pair as a suggestion; automatic linking still leaves it alone. The pairKey comes from list_link_suggestions with ignored: true.",
    input: z.object({ pairKey }),
    annotations: { idempotentHint: true },
    run: async (userId, { pairKey }) => {
      await restoreSuggestion(userId, pairKey);
      return { ok: true, id: pairKey };
    },
  }),
];
