"use server";

import { requireSession } from "@/server/auth/permissions";
import { categoryInputSchema } from "@/lib/validation/category";
import {
  createCategory,
  updateCategory,
  deleteCategory,
  CategoryAccessError,
} from "@/server/services/categories";

export type CategoryActionState = { ok: true } | { ok: false; error: string } | null;

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
  if (!parsed.success) return { ok: false, error: "INVALID" };
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
  if (!parsed.success) return { ok: false, error: "INVALID" };
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
  try {
    await deleteCategory(id, { id: user.id });
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
  return { ok: true };
}
