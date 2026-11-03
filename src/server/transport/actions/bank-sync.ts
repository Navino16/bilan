"use server";

import { requirePermission } from "@/server/auth/permissions";
import { bankSyncTestLimiter } from "@/server/auth/rate-limit";
import {
  BankSyncConfigError,
  bankSyncConfigSchema,
  deleteBankSyncConfig,
  testBankSyncConfig,
  upsertBankSyncConfig,
  type BankSyncTestResult,
} from "@/server/services/bank-sync/config";
import { failureOnField, invalidInput, type FormFailure } from "@/lib/validation/field-errors";

export type BankSyncConfigState = { ok: true } | FormFailure | null;

export async function saveBankSyncConfigAction(
  _prev: BankSyncConfigState,
  formData: FormData,
): Promise<BankSyncConfigState> {
  const user = await requirePermission("admin.security.write");
  const input = {
    applicationId: String(formData.get("applicationId") ?? ""),
    privateKey: String(formData.get("privateKey") ?? ""),
    enabled: ["on", "true"].includes(String(formData.get("enabled") ?? "")),
  };
  const parsed = bankSyncConfigSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error, input);
  try {
    await upsertBankSyncConfig(parsed.data, { id: user.id });
  } catch (e) {
    if (e instanceof BankSyncConfigError) {
      return failureOnField({ ok: false, error: e.code }, { [e.code]: "privateKey" });
    }
    return { ok: false, error: "FAILED" };
  }
  return { ok: true };
}

export type BankSyncTestState = BankSyncTestResult | { ok: false; error: "RATE_LIMITED" } | null;

export async function testBankSyncConfigAction(): Promise<BankSyncTestState> {
  const user = await requirePermission("admin.security.write");
  if (!bankSyncTestLimiter.consume(user.id).allowed) return { ok: false, error: "RATE_LIMITED" };
  return testBankSyncConfig({ id: user.id });
}

export async function deleteBankSyncConfigAction(): Promise<{ ok: true } | FormFailure> {
  const user = await requirePermission("admin.security.write");
  try {
    await deleteBankSyncConfig({ id: user.id });
  } catch {
    return { ok: false, error: "FAILED" };
  }
  return { ok: true };
}
