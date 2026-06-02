"use server";

import { requireSession } from "@/server/auth/permissions";
import { accountInputSchema } from "@/lib/validation/account";
import {
  createAccount,
  updateAccount,
  archiveAccount,
  getAccountIban,
  AccountAccessError,
} from "@/server/services/accounts";

export type AccountActionState = { ok: true } | { ok: false; error: string } | null;

function parse(formData: FormData) {
  return accountInputSchema.safeParse({
    name: formData.get("name") ?? "",
    type: formData.get("type") ?? "",
    iban: formData.get("iban") ?? "",
    bankName: formData.get("bankName") ?? "",
    color: formData.get("color") || undefined,
    icon: formData.get("icon") || undefined,
    initialBalance: formData.get("initialBalance") ?? "",
  });
}

export async function createAccountAction(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const user = await requireSession();
  const parsed = parse(formData);
  if (!parsed.success) return { ok: false, error: "INVALID" };
  try {
    await createAccount(parsed.data, user.id);
  } catch (e) {
    return { ok: false, error: e instanceof AccountAccessError ? "INVALID_IBAN" : "FAILED" };
  }
  return { ok: true };
}

export async function updateAccountAction(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const user = await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "INVALID" };
  const parsed = parse(formData);
  if (!parsed.success) return { ok: false, error: "INVALID" };
  try {
    await updateAccount(id, parsed.data, { id: user.id });
  } catch (e) {
    return { ok: false, error: e instanceof AccountAccessError ? "FORBIDDEN" : "FAILED" };
  }
  return { ok: true };
}

export async function revealAccountIbanAction(id: string): Promise<string | null> {
  const user = await requireSession();
  if (!id) return null;
  return getAccountIban(id, user.id);
}

export async function archiveAccountAction(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const user = await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "INVALID" };
  try {
    await archiveAccount(id, { id: user.id });
  } catch (e) {
    return { ok: false, error: e instanceof AccountAccessError ? "FORBIDDEN" : "FAILED" };
  }
  return { ok: true };
}
