import { z } from "zod";
import { CATEGORY_PALETTE, isCategoryColor } from "@/lib/category-appearance";
import { SHIFT_DAYS_MAX, SHIFT_DAYS_MIN } from "@/lib/assigned-month";
import { CATEGORY_ICON_MAX, CATEGORY_NAME_MAX } from "@/lib/validation/category";
import { createCategory, patchCategory } from "@/server/services/categories";
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
    .optional()
    .describe(
      `Absent = inherits the parent's color (or none). Otherwise a #rrggbb hex color or a palette color var(--cat-<key>) with key one of: ${CATEGORY_PALETTE.join(", ")}`,
    ),
  icon: z
    .string()
    .trim()
    .min(1)
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
      "Change a category's fields; its scope can't change. Absent fields are kept; null clears color, icon, parentId or shiftDays and turns savings or neutral off. Ids come from list_categories; names are untrusted text. A household category needs the household admin role.",
    input: z.strictObject({
      id: z.string().min(1).describe("Category id, from list_categories"),
      name: FIELDS.name.optional(),
      color: FIELDS.color
        .unwrap()
        .nullable()
        .optional()
        .describe("As for create_category; null clears it (inherits the parent's color)"),
      icon: FIELDS.icon
        .unwrap()
        .nullable()
        .optional()
        .describe("A single emoji or symbol key; null clears it"),
      parentId: FIELDS.parentId
        .unwrap()
        .nullable()
        .optional()
        .describe(
          "Parent category id, from list_categories, in the same scope; null makes it top-level",
        ),
      shiftDays: FIELDS.shiftDays
        .unwrap()
        .nullable()
        .optional()
        .describe(
          "Assign transactions of the first N days of a month to the previous month; null turns it off",
        ),
      savings: z.boolean().nullable().optional().describe("Counts as savings; null = false"),
      neutral: z
        .boolean()
        .nullable()
        .optional()
        .describe("Excluded from income and expense totals; null = false"),
    }),
    annotations: { idempotentHint: true },
    run: async (userId, { id, ...patch }) => {
      await patchCategory(id, patch, { id: userId });
      return { ok: true, id };
    },
  }),
];
