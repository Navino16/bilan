import { z } from "zod";
import { isCategoryColor } from "@/lib/category-appearance";
import { CATEGORY_ICON_MAX, categoryNameSchema } from "@/lib/validation/category";
import { ruleInputSchema, type RuleMatchType } from "@/lib/validation/rule";

export const RULES_FILE_FORMAT = "bilan-rules";
export const RULES_FILE_VERSION = 1;
// Stays under the 1 MB server-action body limit.
export const RULES_FILE_MAX_BYTES = 512 * 1024;
export const RULES_FILE_MAX_RULES = 2000;
export const RULES_FILE_MAX_DEPTH = 10;

export const categoryLevelSchema = z.object({
  name: categoryNameSchema,
  color: z.string().refine(isCategoryColor).optional(),
  icon: z.string().trim().min(1).max(CATEGORY_ICON_MAX).optional(),
});

export const fileRuleSchema = ruleInputSchema
  .pick({ pattern: true, matchType: true, caseSensitive: true })
  .extend({
    priority: z.number().int().min(0).max(10000).default(100),
    enabled: z.boolean().default(true),
    category: z.array(categoryLevelSchema).min(1).max(RULES_FILE_MAX_DEPTH),
  });

export const rulesEnvelopeSchema = z.object({
  format: z.literal(RULES_FILE_FORMAT),
  version: z.literal(RULES_FILE_VERSION),
  rules: z.array(z.unknown()),
});

export type CategoryLevel = { name: string; color?: string; icon?: string };

export type FileRule = {
  pattern: string;
  matchType: RuleMatchType;
  caseSensitive: boolean;
  priority: number;
  enabled: boolean;
  category: CategoryLevel[];
};

export type RulesFile = {
  format: typeof RULES_FILE_FORMAT;
  version: typeof RULES_FILE_VERSION;
  exportedAt: string;
  rules: FileRule[];
};

export type RejectedRule = {
  index: number;
  pattern: string | null;
  reason: "INVALID" | "INVALID_REGEX";
};
