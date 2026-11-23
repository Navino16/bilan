import { z } from "zod";
import { isCategoryColor } from "@/lib/category-appearance";
import { CATEGORY_ICON_MAX } from "@/lib/validation/category";
import {
  RULES_FILE_FORMAT,
  RULES_FILE_MAX_DEPTH,
  RULES_FILE_VERSION,
} from "@/lib/validation/rules-file";
import { categoryNameSchema } from "./category";
import { ruleInputSchema } from "./rule";

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
