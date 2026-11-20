import { z } from "zod";
import { RULE_MATCH_TYPES } from "@/lib/validation/rule";
import {
  createRule,
  deleteRule,
  retargetRule,
  toggleRule,
  updateRule,
} from "@/server/services/categorization";
import { applyRules } from "@/server/services/categorization/apply";
import { ruleIdsInput } from "@/server/mcp/tools/inputs";
import { writeTool } from "@/server/mcp/tools/write-tool";

const ruleId = z.string().min(1).describe("Rule id, from list_rules");
const categoryId = z
  .string()
  .min(1)
  .describe("Category id, from list_categories; the user must be able to use it");

const FIELDS = {
  pattern: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe(
      "Text matched against the bank label (untrusted text); a regular expression for REGEX",
    ),
  matchType: z.enum(RULE_MATCH_TYPES),
  caseSensitive: z.boolean().optional().describe("Defaults to false"),
  priority: z
    .number()
    .int()
    .min(0)
    .max(10000)
    .optional()
    .describe("Higher wins when several rules match; defaults to 100"),
  categoryId,
};

export const RULE_WRITE_TOOLS = [
  writeTool({
    name: "create_rule",
    description:
      "Create a personal categorization rule, or a household one with groupId (household admin role needed). Ids come from list_households and list_categories. It only applies to new transactions until apply_rules runs.",
    input: z.strictObject({
      ...FIELDS,
      groupId: z
        .string()
        .min(1)
        .optional()
        .describe("Household id, from list_households, for a household rule (ADMIN only)"),
    }),
    run: async (userId, args) => ({ ok: true, id: (await createRule(args, { id: userId })).id }),
  }),
  writeTool({
    name: "update_rule",
    description:
      "Replace a rule's fields; its scope can't change. Send every current field from list_rules: absent caseSensitive and priority reset to false and 100. A household rule needs the household admin role.",
    input: z.strictObject({ id: ruleId, ...FIELDS }),
    annotations: { idempotentHint: true },
    run: async (userId, { id, ...input }) => {
      await updateRule(id, input, { id: userId });
      return { ok: true, id };
    },
  }),
  writeTool({
    name: "retarget_rule",
    description:
      "Point a rule at another category, keeping its pattern, match and priority. A household rule needs the household admin role.",
    input: z.strictObject({ id: ruleId, categoryId }),
    annotations: { idempotentHint: true },
    run: async (userId, { id, categoryId }) => {
      await retargetRule(id, categoryId, { id: userId });
      return { ok: true, id };
    },
  }),
  writeTool({
    name: "toggle_rule",
    description:
      "Enable or disable a rule; a disabled rule matches nothing. A household rule needs the household admin role.",
    input: z.strictObject({ id: ruleId, enabled: z.boolean() }),
    annotations: { idempotentHint: true },
    run: async (userId, { id, enabled }) => {
      await toggleRule(id, enabled, { id: userId });
      return { ok: true, id };
    },
  }),
  writeTool({
    name: "delete_rule",
    description:
      "Delete a rule; transactions it already categorized keep their category. A household rule needs the household admin role.",
    input: z.strictObject({ id: ruleId }),
    annotations: { destructiveHint: true },
    run: async (userId, { id }) => {
      await deleteRule(id, { id: userId });
      return { ok: true, id };
    },
  }),
  writeTool({
    name: "apply_rules",
    description:
      "Recategorize the existing transactions the given enabled rules match, on the accounts this assistant may write; manually categorized transactions are kept. Run preview_rules_application first and show the user what moves. Every rule must be one the user manages.",
    input: z.strictObject({ ruleIds: ruleIdsInput }),
    annotations: { destructiveHint: true },
    run: async (userId, args) => ({
      ok: true,
      reclassified: (await applyRules(args.ruleIds, { id: userId })).reclassified,
    }),
  }),
];
