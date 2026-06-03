import { z } from "zod";

export const RULE_MATCH_TYPES = ["CONTAINS", "EXACT", "STARTS_WITH", "REGEX"] as const;
export type RuleMatchType = (typeof RULE_MATCH_TYPES)[number];

export const ruleInputSchema = z.object({
  pattern: z.string().trim().min(1).max(200),
  matchType: z.enum(RULE_MATCH_TYPES),
  caseSensitive: z.boolean().default(false),
  priority: z.coerce.number().int().min(0).max(10000).default(100),
  categoryId: z.string().min(1),
  groupId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export type RuleInput = z.input<typeof ruleInputSchema>;
