"use server";

import { getCurrentSession, requireSession } from "@/server/auth/permissions";
import { changePasswordLimiter, withRefund } from "@/server/auth/rate-limit";
import { logEvent } from "@/server/services/audit";
import { accountInputSchema } from "@/lib/validation/account";
import { AMOUNT_ERRORS } from "@/lib/amount";
import { issueCode } from "@/lib/validation/amount";
import { invalidInput, type FormFailure } from "@/lib/validation/field-errors";
import {
  createAccount,
  updateAccount,
  archiveAccount,
  unarchiveAccount,
  AccountAccessError,
} from "@/server/services/accounts";
import { revealAccountIban, type IbanRevealResult } from "@/server/services/accounts/iban-reveal";
import {
  deleteAccount,
  getAccountDeleteImpact,
  type AccountDeleteImpact,
} from "@/server/services/accounts/delete";
import {
  shareAccountWithGroup,
  revokeShare,
  listSharesForAccount,
  type SharePermission,
} from "@/server/services/accounts/sharing";

export type AccountActionState = { ok: true } | FormFailure | null;

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
  if (!parsed.success)
    return invalidInput(parsed.error, undefined, issueCode(parsed.error.issues, AMOUNT_ERRORS));
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
  if (!parsed.success)
    return invalidInput(parsed.error, undefined, issueCode(parsed.error.issues, AMOUNT_ERRORS));
  try {
    await updateAccount(
      id,
      parsed.data,
      { id: user.id },
      {
        removeIban: formData.get("removeIban") === "1",
      },
    );
  } catch (e) {
    return { ok: false, error: e instanceof AccountAccessError ? "FORBIDDEN" : "FAILED" };
  }
  return { ok: true };
}

export type IbanRevealState =
  | IbanRevealResult
  | { ok: false; error: "RATE_LIMITED"; retryAfter: number };

// Wrong passwords draw on the per-user bucket shared with password change and 2FA.
export async function revealAccountIbanAction(
  id: unknown,
  password?: unknown,
): Promise<IbanRevealState> {
  const user = await requireSession();
  const session = await getCurrentSession();
  if (!session || typeof id !== "string" || !id) return { ok: false, error: "NOT_FOUND" };
  const input = {
    accountId: id,
    userId: user.id,
    sessionCreatedAt: new Date(session.session.createdAt),
  };
  if (typeof password !== "string" || !password) return revealAccountIban(input);
  const res = await withRefund(
    changePasswordLimiter,
    user.id,
    () => revealAccountIban({ ...input, password }),
    (r) => !r.ok && r.error === "BAD_PASSWORD",
  );
  if (res.allowed) return res.result;
  await logEvent({
    userId: user.id,
    action: "account.iban.reveal_failed",
    entity: "BankAccount",
    entityId: id,
    metadata: { reason: "rate_limit" },
  });
  return { ok: false, error: "RATE_LIMITED", retryAfter: res.retryAfterSec };
}

async function setArchived(formData: FormData, archived: boolean): Promise<AccountActionState> {
  const user = await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "INVALID" };
  try {
    await (archived ? archiveAccount : unarchiveAccount)(id, { id: user.id });
  } catch (e) {
    return { ok: false, error: e instanceof AccountAccessError ? "FORBIDDEN" : "FAILED" };
  }
  return { ok: true };
}

export async function archiveAccountAction(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  return setArchived(formData, true);
}

export async function unarchiveAccountAction(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  return setArchived(formData, false);
}

export async function getAccountDeleteImpactAction(
  id: string,
): Promise<{ ok: true; data: AccountDeleteImpact } | { ok: false; error: string }> {
  const user = await requireSession();
  try {
    return { ok: true, data: await getAccountDeleteImpact(id, { id: user.id }) };
  } catch (e) {
    return { ok: false, error: e instanceof AccountAccessError ? "FORBIDDEN" : "FAILED" };
  }
}

export async function deleteAccountAction(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const user = await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "INVALID" };
  try {
    await deleteAccount(id, { id: user.id }, String(formData.get("confirmName") ?? ""));
  } catch (e) {
    if (!(e instanceof AccountAccessError)) return { ok: false, error: "FAILED" };
    return { ok: false, error: e.message === "CONFIRMATION" ? "CONFIRMATION" : "FORBIDDEN" };
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
