"use server";

import { requireSession } from "@/server/auth/permissions";
import { transactionInputSchema } from "@/lib/validation/transaction";
import {
  createTransaction,
  recategorizeTransaction,
  TransactionAccessError,
} from "@/server/services/transactions";
import {
  deleteTransactions,
  getDeleteImpact,
  type DeleteImpact,
} from "@/server/services/transactions/delete";
import { recordHits, suggest } from "@/server/services/categorization";

export type TxActionState = { ok: true; id?: string } | { ok: false; error: string } | null;

function mapError(e: unknown): string {
  return e instanceof TransactionAccessError ? e.message || "FORBIDDEN" : "FAILED";
}

export async function createTransactionAction(
  _prev: TxActionState,
  formData: FormData,
): Promise<TxActionState> {
  const user = await requireSession();
  const parsed = transactionInputSchema.safeParse({
    accountId: formData.get("accountId") ?? "",
    date: formData.get("date") ?? "",
    amount: formData.get("amount") ?? "",
    type: formData.get("type") ?? "OTHER",
    label: formData.get("label") ?? "",
    note: formData.get("note") || undefined,
    categoryId: formData.get("categoryId") || undefined,
  });
  if (!parsed.success) return { ok: false, error: "INVALID" };
  try {
    // If the user didn't pick a category, fall back to the rule engine.
    let categoryId = parsed.data.categoryId ?? null;
    let manual = Boolean(parsed.data.categoryId);
    let ruleId: string | null = null;
    if (!categoryId) {
      const s = await suggest(parsed.data.label, { userId: user.id });
      categoryId = s.categoryId;
      ruleId = s.ruleId;
      manual = false;
    }
    const { id } = await createTransaction(
      { ...parsed.data, categoryId: categoryId ?? undefined },
      { id: user.id },
      { manuallyCategorized: manual },
    );
    // Best-effort: a failed counter must not report a saved transaction as failed.
    await recordHits([ruleId]).catch(() => {});
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
}

export async function recategorizeTransactionAction(
  _prev: TxActionState,
  formData: FormData,
): Promise<TxActionState> {
  const user = await requireSession();
  const id = String(formData.get("id") ?? "");
  const categoryId = String(formData.get("categoryId") ?? "") || null;
  if (!id) return { ok: false, error: "INVALID" };
  try {
    await recategorizeTransaction(id, categoryId, { id: user.id });
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
  return { ok: true };
}

export type TxResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function runOnIds<T>(
  ids: unknown,
  fn: (userId: string, ids: string[]) => Promise<T>,
): Promise<TxResult<T>> {
  const user = await requireSession();
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
    return { ok: false, error: "INVALID" };
  }
  try {
    return { ok: true, data: await fn(user.id, ids) };
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
}

export async function getDeleteImpactAction(ids: string[]): Promise<TxResult<DeleteImpact>> {
  return runOnIds(ids, getDeleteImpact);
}

export async function deleteTransactionsAction(
  ids: string[],
): Promise<TxResult<{ deleted: number; linksDissolved: number }>> {
  return runOnIds(ids, deleteTransactions);
}
