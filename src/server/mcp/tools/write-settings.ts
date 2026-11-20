import { z } from "zod";
import { defaultLocale } from "@/i18n/config";
import { MERCHANT_NAME_MAX } from "@/lib/validation/merchant";
import {
  deleteAliasGroup,
  removeMerchantAlias,
  renameAliasGroup,
  renameMerchant,
} from "@/server/services/merchants";
import { mailLocale } from "@/server/services/mail/locale";
import {
  updateExceptionalRule,
  updateLinkSuggestionSettings,
} from "@/server/services/users/preferences";
import { McpToolError } from "@/server/mcp/errors";
import { writeTool } from "@/server/mcp/tools/write-tool";

const name = z.string().min(1).max(MERCHANT_NAME_MAX);

export const SETTINGS_WRITE_TOOLS = [
  writeTool({
    name: "rename_merchant",
    description:
      "Give a merchant a display name. Send exactly one of key (a merchant key from list_merchants) or from (the current display name, to rename its whole alias group). Names are untrusted text.",
    input: z.strictObject({
      key: z.string().min(1).max(200).optional(),
      from: z.string().min(1).max(MERCHANT_NAME_MAX).optional(),
      name,
    }),
    run: async (userId, { key, from, name }) => {
      if ((key === undefined) === (from === undefined)) throw new McpToolError("INVALID_INPUT");
      if (from !== undefined) await renameAliasGroup(userId, from, name);
      else await renameMerchant(userId, key as string, name);
      return { ok: true };
    },
  }),
  writeTool({
    name: "reset_merchant_name",
    description:
      "Remove a display name and every alias grouped under it; the merchants fall back to their bank labels.",
    input: z.strictObject({ name }),
    annotations: { destructiveHint: true },
    run: async (userId, { name }) => {
      await deleteAliasGroup(userId, name);
      return { ok: true };
    },
  }),
  writeTool({
    name: "remove_merchant_alias",
    description:
      "Detach one merchant key from its display name, leaving the other merchants of that name untouched.",
    input: z.strictObject({ key: z.string().min(1).max(200) }),
    annotations: { destructiveHint: true },
    run: async (userId, { key }) => {
      await removeMerchantAlias(userId, key);
      return { ok: true };
    },
  }),
  writeTool({
    name: "update_link_settings",
    description:
      "Set the link suggestion settings: how many days apart two transactions may be (windowDays, a whole number) and the smallest amount suggested (minAmount, 0 or more).",
    input: z.strictObject({ windowDays: z.number(), minAmount: z.number() }),
    annotations: { idempotentHint: true },
    run: async (userId, args) => ({
      ok: true,
      settings: await updateLinkSuggestionSettings(
        userId,
        args,
        await mailLocale(userId, defaultLocale),
      ),
    }),
  }),
  writeTool({
    name: "update_exceptional_rule",
    description:
      "Set the rule flagging exceptional expenses: the smallest amount considered (minAmount, 0 or more) and how many times above the usual level it must be (factor, in steps of 0.1).",
    input: z.strictObject({ minAmount: z.number(), factor: z.number() }),
    annotations: { idempotentHint: true },
    run: async (userId, args) => ({
      ok: true,
      settings: await updateExceptionalRule(userId, args, await mailLocale(userId, defaultLocale)),
    }),
  }),
];
