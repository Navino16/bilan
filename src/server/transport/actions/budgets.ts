"use server";

import { requireSession } from "@/server/auth/permissions";
import {
  createBudget,
  updateBudget,
  deleteBudget,
  BudgetAccessError,
} from "@/server/services/budgets";
import { budgetInputSchema } from "@/lib/validation/budget";

export type BudgetActionState = { ok: true; id?: string } | { ok: false; error: string } | null;

function mapError(e: unknown): string {
  return e instanceof BudgetAccessError ? e.message || "FORBIDDEN" : "FAILED";
}

function parse(formData: FormData) {
  let lines: unknown = [];
  try {
    lines = JSON.parse(String(formData.get("lines") ?? "[]"));
  } catch {
    lines = [];
  }
  return budgetInputSchema.safeParse({
    name: formData.get("name") ?? "",
    description: formData.get("description") ?? "",
    groupId: formData.get("groupId") ?? "",
    periodType: formData.get("periodType") ?? "MONTH",
    periodStart: formData.get("periodStart") ?? "",
    periodEnd: formData.get("periodEnd") ?? "",
    recurring: formData.get("recurring") === "on" || formData.get("recurring") === "true",
    lines,
  });
}

export async function createBudgetAction(
  _prev: BudgetActionState,
  formData: FormData,
): Promise<BudgetActionState> {
  const user = await requireSession();
  const parsed = parse(formData);
  if (!parsed.success) return { ok: false, error: "INVALID" };
  try {
    const { id } = await createBudget(parsed.data, { id: user.id });
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
}

export async function updateBudgetAction(
  _prev: BudgetActionState,
  formData: FormData,
): Promise<BudgetActionState> {
  const user = await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "INVALID" };
  const parsed = parse(formData);
  if (!parsed.success) return { ok: false, error: "INVALID" };
  try {
    await updateBudget(id, parsed.data, { id: user.id });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
}

export async function deleteBudgetAction(
  _prev: BudgetActionState,
  formData: FormData,
): Promise<BudgetActionState> {
  const user = await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "INVALID" };
  try {
    await deleteBudget(id, { id: user.id });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
}
