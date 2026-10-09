import { z } from "zod";
import { isCategoryColor } from "@/lib/category-appearance";

export const CATEGORY_NAME_MAX = 60;
export const CATEGORY_ICON_MAX = 50;

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

// A category is owned by the current user (personal) when `groupId` is absent,
// or by a group when `groupId` is set. The XOR (userId vs groupId) is resolved
// in the service from the session + this field, and enforced by a DB CHECK.
export const categoryInputSchema = z.object({
  name: z.string().trim().min(1).max(CATEGORY_NAME_MAX),
  color: z.preprocess(emptyToUndefined, z.string().refine(isCategoryColor).optional()),
  icon: z.preprocess(emptyToUndefined, z.string().trim().max(CATEGORY_ICON_MAX).optional()),
  parentId: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  groupId: z.preprocess(emptyToUndefined, z.string().trim().optional()),
});

export type CategoryInput = z.input<typeof categoryInputSchema>;
