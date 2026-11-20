import { z } from "zod";
import { CATEGORY_PALETTE, isCategoryColor } from "@/lib/category-appearance";
import { SHIFT_DAYS_MAX, SHIFT_DAYS_MIN } from "@/lib/assigned-month";
import { CATEGORY_ICON_MAX, CATEGORY_NAME_MAX } from "@/lib/validation/category";
import { createCategory, updateCategory } from "@/server/services/categories";
import { writeTool } from "@/server/mcp/tools/write-tool";

const FIELDS = {
  name: z
    .string()
    .trim()
    .min(1)
    .max(CATEGORY_NAME_MAX)
    .describe("Category name (untrusted text, no control characters)"),
  color: z
    .string()
    .refine(isCategoryColor)
    .describe(
      `A #rrggbb hex color or a palette color var(--cat-<key>) with key one of: ${CATEGORY_PALETTE.join(", ")}`,
    ),
  icon: z
    .string()
    .trim()
    .max(CATEGORY_ICON_MAX)
    .optional()
    .describe("A single emoji or symbol key"),
  parentId: z
    .string()
    .min(1)
    .optional()
    .describe("Parent category id, from list_categories; it must be in the same scope"),
  shiftDays: z
    .number()
    .int()
    .min(SHIFT_DAYS_MIN)
    .max(SHIFT_DAYS_MAX)
    .optional()
    .describe("Assign transactions of the first N days of a month to the previous month"),
  savings: z.boolean().optional().describe("Counts as savings"),
  neutral: z.boolean().optional().describe("Excluded from income and expense totals"),
};

export const CATEGORY_WRITE_TOOLS = [
  writeTool({
    name: "create_category",
    description:
      "Create a personal category, or a household one with groupId (household admin role needed). Ids come from list_households and list_categories; names are untrusted text.",
    input: z.strictObject({
      ...FIELDS,
      groupId: z
        .string()
        .min(1)
        .optional()
        .describe("Household id, from list_households, for a household category (ADMIN only)"),
    }),
    run: async (userId, args) => ({
      ok: true,
      id: (await createCategory(args, { id: userId })).id,
    }),
  }),
  writeTool({
    name: "update_category",
    description:
      "Replace a category's fields; its scope can't change. Send every current field from list_categories: absent optional fields (icon, parentId, shiftDays, savings, neutral) are cleared. A household category needs the household admin role.",
    input: z.strictObject({
      id: z.string().min(1).describe("Category id, from list_categories"),
      ...FIELDS,
    }),
    annotations: { idempotentHint: true },
    run: async (userId, { id, ...input }) => {
      await updateCategory(id, input, { id: userId });
      return { ok: true, id };
    },
  }),
];
