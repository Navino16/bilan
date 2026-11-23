import { z } from "zod";
import { RULE_MATCH_TYPES } from "@/lib/validation/rule";
import { createRule, deleteRule, patchRule, toggleRule } from "@/server/services/categorization";
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
  matchType: z
    .enum(RULE_MATCH_TYPES)
    .describe("How pattern meets the label: CONTAINS, EXACT, STARTS_WITH or REGEX"),
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
      "Change a rule's fields, its category included; its scope can't change. Absent fields are kept; null resets caseSensitive to false and priority to 100. Transactions it already categorized keep their category until apply_rules runs with it. A household rule needs the household admin role.",
    input: z.strictObject({
      id: ruleId,
      pattern: FIELDS.pattern.optional(),
      matchType: FIELDS.matchType.optional(),
      caseSensitive: z.boolean().nullable().optional().describe("null = false"),
      priority: FIELDS.priority
        .unwrap()
        .nullable()
        .optional()
        .describe("Higher wins when several rules match; null = 100"),
      categoryId: categoryId.optional(),
    }),
    annotations: { idempotentHint: true },
    run: async (userId, { id, ...patch }) => {
      await patchRule(id, patch, { id: userId });
      return { ok: true, id };
    },
  }),
  writeTool({
    name: "toggle_rule",
    description:
      "Enable or disable a rule; a disabled rule matches nothing, and transactions it already categorized keep their category. A household rule needs the household admin role.",
    input: z.strictObject({ id: ruleId, enabled: z.boolean().describe("false disables the rule") }),
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
