"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isBankCountry } from "@/lib/bank-sync";
import { parseMappingForm } from "@/lib/schemas/bank-sync";
import { requirePermission, requireSession } from "@/server/auth/permissions";
import { bankAuthStartLimiter, bankSyncTestLimiter } from "@/server/auth/rate-limit";
import { requestOrigin } from "@/server/http/client-ip";
import { listBanks, startBankAuth, type BankOption } from "@/server/services/bank-sync/connect";
import { BankSyncError, type BankSyncFlowCode } from "@/server/services/bank-sync/errors";
import { saveBankMapping } from "@/server/services/bank-sync/mapping";
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

function flowCode(e: unknown, context: string): BankSyncFlowCode | "FAILED" {
  if (e instanceof BankSyncError) return e.code;
  console.error(`[bilan] ${context} failed`, e instanceof Error ? e.name : typeof e);
  return "FAILED";
}

export async function listBanksAction(
  country: string,
): Promise<BankOption[] | { error: BankSyncFlowCode | "FAILED" }> {
  await requireSession();
  if (!isBankCountry(country)) return { error: "UNKNOWN_BANK" };
  try {
    return await listBanks(country);
  } catch (e) {
    return { error: flowCode(e, "bank list") };
  }
}

export async function startBankAuthAction(
  _prev: FormFailure | null,
  formData: FormData,
): Promise<FormFailure> {
  const user = await requireSession();
  const country = String(formData.get("country") ?? "");
  const aspspName = String(formData.get("aspspName") ?? "").trim();
  const reconnectOf = String(formData.get("reconnectOf") ?? "") || undefined;
  if (!isBankCountry(country)) return { ok: false, error: "UNKNOWN_BANK" };
  if (!aspspName)
    return { ok: false, error: "UNKNOWN_BANK", fieldErrors: { aspspName: "REQUIRED" } };
  if (!bankAuthStartLimiter.consume(user.id).allowed) {
    return { ok: false, error: "RATE_LIMITED_LOCAL" };
  }
  let url: string;
  try {
    ({ url } = await startBankAuth(user.id, { aspspName, country, reconnectOf }));
  } catch (e) {
    return { ok: false, error: flowCode(e, "bank authorization start") };
  }
  redirect(url);
}

export type BankMappingState =
  | { ok: true; accounts: { name: string; imported: number }[] }
  | FormFailure
  | null;

export async function saveBankMappingAction(
  connectionId: string,
  _prev: BankMappingState,
  formData: FormData,
): Promise<BankMappingState> {
  const user = await requireSession();
  const parsed = parseMappingForm(formData);
  if (!parsed.ok) return { ok: false, error: "INVALID", fieldErrors: parsed.fieldErrors };
  try {
    const { accounts } = await saveBankMapping(user.id, connectionId, parsed.choices, {
      psu: requestOrigin(await headers()),
    });
    return { ok: true, accounts: accounts.map((a) => ({ name: a.name, imported: a.imported })) };
  } catch (e) {
    return { ok: false, error: flowCode(e, "bank mapping") };
  }
}
