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
import {
  shareAccountWithGroup,
  revokeShare,
  listSharesForAccount,
  type SharePermission,
} from "@/server/services/accounts/sharing";

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

export async function shareAccountAction(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const user = await requireSession();
  const accountId = String(formData.get("accountId") ?? "");
  const groupId = String(formData.get("groupId") ?? "");
  const permission = String(formData.get("permission") ?? "") as SharePermission;
  if (!accountId || !groupId) return { ok: false, error: "INVALID" };
  try {
    await shareAccountWithGroup({ accountId, groupId, permission }, { id: user.id });
  } catch (e) {
    return { ok: false, error: e instanceof AccountAccessError ? "FORBIDDEN" : "FAILED" };
  }
  return { ok: true };
}

export async function revokeShareAction(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const user = await requireSession();
  const accountId = String(formData.get("accountId") ?? "");
  const groupId = String(formData.get("groupId") ?? "");
  if (!accountId || !groupId) return { ok: false, error: "INVALID" };
  try {
    await revokeShare({ accountId, groupId }, { id: user.id });
  } catch (e) {
    return { ok: false, error: e instanceof AccountAccessError ? "FORBIDDEN" : "FAILED" };
  }
  return { ok: true };
}

// Returns the current shares for an owned account, for the share dialog to
// pre-fill its per-group permission state. Returns [] on any access error.
export async function listSharesAction(
  accountId: string,
): Promise<{ groupId: string; permission: string }[]> {
  const user = await requireSession();
  if (!accountId) return [];
  try {
    const shares = await listSharesForAccount(accountId, { id: user.id });
    return shares.map((s) => ({ groupId: s.groupId, permission: s.permission }));
  } catch {
    return [];
  }
}
