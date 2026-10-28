import { z } from "zod";
import { isCategoryColor } from "@/lib/category-appearance";
import { CATEGORY_ICON_MAX, CATEGORY_NAME_MAX } from "@/lib/validation/category";
import { SHIFT_DAYS_MAX, SHIFT_DAYS_MIN } from "@/lib/assigned-month";

// Control characters would break the rules-file path keys, which join levels with U+001F (#291).
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export const categoryNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(CATEGORY_NAME_MAX)
  .refine((name) => !CONTROL_CHARS.test(name));

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

// A category is owned by the current user (personal) when `groupId` is absent,
// or by a group when `groupId` is set. The XOR (userId vs groupId) is resolved
// in the service from the session + this field; no DB CHECK, MariaDB rejects one on a FK column.
export const categoryInputSchema = z.object({
  name: categoryNameSchema,
  color: z.preprocess(emptyToUndefined, z.string().refine(isCategoryColor).optional()),
  icon: z.preprocess(emptyToUndefined, z.string().trim().max(CATEGORY_ICON_MAX).optional()),
  parentId: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  groupId: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  shiftDays: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(SHIFT_DAYS_MIN).max(SHIFT_DAYS_MAX).optional(),
  ),
  savings: z.boolean().optional(),
});

export type CategoryInput = z.input<typeof categoryInputSchema>;
