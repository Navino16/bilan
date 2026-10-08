"use server";

import { requireSession } from "@/server/auth/permissions";
import { categoryInputSchema } from "@/lib/validation/category";
import { invalidInput, type FormFailure } from "@/lib/validation/field-errors";
import {
  createCategory,
  updateCategory,
  deleteCategory,
  getCategoryDeletionImpact,
  CategoryAccessError,
  type CategoryDeletionImpact,
} from "@/server/services/categories";

export type CategoryActionState = { ok: true } | FormFailure | null;

function parse(formData: FormData) {
  return categoryInputSchema.safeParse({
    name: formData.get("name") ?? "",
    color: formData.get("color") || undefined,
    icon: formData.get("icon") || undefined,
    parentId: formData.get("parentId") ?? "",
    groupId: formData.get("groupId") ?? "",
  });
}

function mapError(e: unknown): string {
  return e instanceof CategoryAccessError ? e.message || "FORBIDDEN" : "FAILED";
}

export async function createCategoryAction(
  _prev: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const user = await requireSession();
  const parsed = parse(formData);
  if (!parsed.success) return invalidInput(parsed.error);
  try {
    await createCategory(parsed.data, { id: user.id });
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
  return { ok: true };
}

export async function updateCategoryAction(
  _prev: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const user = await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "INVALID" };
  const parsed = parse(formData);
  if (!parsed.success) return invalidInput(parsed.error);
  try {
    await updateCategory(id, parsed.data, { id: user.id });
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
  return { ok: true };
}

export async function deleteCategoryAction(
  _prev: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const user = await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "INVALID" };
  const targetId = String(formData.get("targetId") ?? "") || null;
  try {
    await deleteCategory(id, { id: user.id }, { targetId });
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
  return { ok: true };
}

export async function getCategoryDeletionImpactAction(
  id: string,
): Promise<{ ok: true; impact: CategoryDeletionImpact } | { ok: false; error: string }> {
  const user = await requireSession();
  try {
    return { ok: true, impact: await getCategoryDeletionImpact(id, { id: user.id }) };
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
}
