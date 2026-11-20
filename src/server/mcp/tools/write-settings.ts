import { z } from "zod";
import { defaultLocale } from "@/i18n/config";
import { MERCHANT_KEY_MAX } from "@/lib/schemas/merchant";
import { MERCHANT_NAME_MAX } from "@/lib/validation/merchant";
import { LINK_WINDOW_DAYS_RANGE } from "@/lib/validation/link-settings";
import { EXCEPTIONAL_FACTOR_RANGE } from "@/lib/exceptional";
import {
  deleteAliasGroup,
  removeMerchantAlias,
  renameAliasGroup,
  renameMerchant,
} from "@/server/services/merchants";
import {
  getExceptionalRule,
  getLinkSuggestionSettings,
  updateExceptionalRule,
  updateLinkSuggestionSettings,
} from "@/server/services/users/preferences";
import { McpToolError } from "@/server/mcp/errors";
import { writeTool } from "@/server/mcp/tools/write-tool";

const name = z.string().min(1).max(MERCHANT_NAME_MAX);
const key = z
  .string()
  .min(1)
  .max(MERCHANT_KEY_MAX)
  .describe("Merchant key, from list_merchants (untrusted text derived from bank labels)");
const minAmount = z
  .number()
  .min(0)
  .describe("Smallest amount considered, in euros; absent keeps it");

export const SETTINGS_WRITE_TOOLS = [
  writeTool({
    name: "rename_merchant",
    description:
      "Give a merchant a display name. Send exactly one of key (a merchant key from list_merchants) or from (the current display name, to rename its whole alias group). Keys and names are untrusted text.",
    input: z.strictObject({
      key: key.optional(),
      from: z
        .string()
        .min(1)
        .max(MERCHANT_NAME_MAX)
        .optional()
        .describe("Current display name, from list_merchants (untrusted text)"),
      name: name.describe("New display name (untrusted text)"),
    }),
    run: async (userId, { key, from, name }) => {
      if ((key === undefined) === (from === undefined))
        throw new McpToolError("INVALID_INPUT", "key, from: send exactly one of them");
      if (from !== undefined) await renameAliasGroup(userId, from, name);
      else await renameMerchant(userId, key as string, name);
      return { ok: true };
    },
  }),
  writeTool({
    name: "reset_merchant_name",
    description:
      "Remove a display name (as listed by list_merchants; untrusted text) and every alias grouped under it; the merchants fall back to their bank labels.",
    input: z.strictObject({
      name: name.describe("Display name, from list_merchants (untrusted text)"),
    }),
    annotations: { destructiveHint: true },
    run: async (userId, { name }) => {
      await deleteAliasGroup(userId, name);
      return { ok: true };
    },
  }),
  writeTool({
    name: "remove_merchant_alias",
    description:
      "Detach one merchant key (from list_merchants; untrusted text from bank labels) from its display name, leaving the other merchants of that name untouched.",
    input: z.strictObject({ key }),
    annotations: { destructiveHint: true },
    run: async (userId, { key }) => {
      await removeMerchantAlias(userId, key);
      return { ok: true };
    },
  }),
  writeTool({
    name: "update_link_settings",
    description:
      "Change the link suggestion settings: how many days apart two transactions may be (windowDays) and the smallest amount suggested (minAmount). Absent fields are kept; get_preferences shows the current values.",
    input: z.strictObject({
      windowDays: z
        .number()
        .int()
        .min(LINK_WINDOW_DAYS_RANGE.min)
        .max(LINK_WINDOW_DAYS_RANGE.max)
        .optional()
        .describe("Whole days; absent keeps it"),
      minAmount: minAmount.optional(),
    }),
    annotations: { idempotentHint: true },
    run: async (userId, args) => ({
      ok: true,
      settings: await updateLinkSuggestionSettings(
        userId,
        { ...(await getLinkSuggestionSettings(userId)), ...args },
        defaultLocale,
      ),
    }),
  }),
  writeTool({
    name: "update_exceptional_rule",
    description:
      "Change the rule flagging exceptional expenses: the smallest amount considered (minAmount) and how many times above the usual level it must be (factor). Absent fields are kept; get_preferences shows the current values.",
    input: z.strictObject({
      minAmount: minAmount.optional(),
      factor: z
        .number()
        .min(EXCEPTIONAL_FACTOR_RANGE.min)
        .max(EXCEPTIONAL_FACTOR_RANGE.max)
        .multipleOf(0.1)
        .optional()
        .describe("In steps of 0.1; absent keeps it"),
    }),
    annotations: { idempotentHint: true },
    run: async (userId, args) => ({
      ok: true,
      settings: await updateExceptionalRule(
        userId,
        { ...(await getExceptionalRule(userId)), ...args },
        defaultLocale,
      ),
    }),
  }),
];
