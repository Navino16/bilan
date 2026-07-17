"use server";

import { requireSession } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { canReadAccount } from "@/server/services/accounts/sharing";
import {
  createBudget,
  updateBudget,
  deleteBudget,
  assignTransaction,
  unassignTransaction,
  listAssignmentsForTx,
  rollRecurring,
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

export async function assignTransactionAction(
  _prev: BudgetActionState,
  formData: FormData,
): Promise<BudgetActionState> {
  const user = await requireSession();
  const budgetId = String(formData.get("budgetId") ?? "");
  const transactionId = String(formData.get("transactionId") ?? "");
  const mode = String(formData.get("mode") ?? "");
  if (!budgetId || !transactionId || (mode !== "INCLUDE" && mode !== "EXCLUDE")) {
    return { ok: false, error: "INVALID" };
  }
  try {
    await assignTransaction({ budgetId, transactionId, mode }, { id: user.id });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
}

export async function unassignTransactionAction(
  _prev: BudgetActionState,
  formData: FormData,
): Promise<BudgetActionState> {
  const user = await requireSession();
  const budgetId = String(formData.get("budgetId") ?? "");
  const transactionId = String(formData.get("transactionId") ?? "");
  if (!budgetId || !transactionId) return { ok: false, error: "INVALID" };
  try {
    await unassignTransaction({ budgetId, transactionId }, { id: user.id });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
}

// Lazy per-transaction fetch for the detail panel: which budgets the tx is
// currently assigned to (INCLUDE/EXCLUDE). Requires a session AND that the
// caller can read the transaction's account — otherwise a session holder could
// enumerate any transaction id and learn its budget assignments (IDOR).
export async function listAssignmentsForTxAction(
  transactionId: string,
): Promise<{ budgetId: string; mode: string }[]> {
  const user = await requireSession();
  if (!transactionId) return [];
  const txRow = await db.transaction.findUnique({
    where: { id: transactionId },
    select: { accountId: true },
  });
  if (!txRow) return [];
  if (!(await canReadAccount(user.id, txRow.accountId))) return [];
  return listAssignmentsForTx(transactionId);
}

export async function rollRecurringAction(
  _prev: BudgetActionState,
  formData: FormData,
): Promise<BudgetActionState> {
  const user = await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "INVALID" };
  try {
    const r = await rollRecurring(id, { id: user.id });
    return { ok: true, id: r.id };
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
}
