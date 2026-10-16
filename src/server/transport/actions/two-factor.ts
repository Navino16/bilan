"use server";

import { authHeaders } from "@/server/http/auth-headers";
import { requireSession } from "@/server/auth/permissions";
import { changePasswordLimiter, withRefund } from "@/server/auth/rate-limit";
import { logEvent } from "@/server/services/audit";
import { isBadPassword } from "@/server/services/users/password";
import {
  disableTwoFactor,
  enableTwoFactor,
  regenerateBackupCodes,
  type FailedAction,
  type TwoFactorEnrolment,
  type TwoFactorError,
} from "@/server/services/users/two-factor";
import {
  revokeAllTrustedDevices,
  revokeTrustedDevice,
  type RevokeTrustedDeviceError,
} from "@/server/services/users/trusted-devices";
import { revokeTrustedDeviceSchema } from "./auth-schemas";

export type TwoFactorActionState<T> =
  | { ok: true; data: T }
  | { ok: false; error: TwoFactorError | "RATE_LIMITED"; retryAfter?: number };

function isBadCredential(res: TwoFactorActionState<unknown>): boolean {
  return isBadPassword(res) || (!res.ok && res.error === "BAD_CODE");
}

// Shares the change-password bucket; only wrong passwords and codes consume it.
async function withPasswordLimit<T>(
  userId: string,
  action: FailedAction,
  run: () => Promise<TwoFactorActionState<T>>,
): Promise<TwoFactorActionState<T>> {
  const res = await withRefund(changePasswordLimiter, userId, run, isBadCredential);
  if (res.allowed) return res.result;
  await logEvent({ userId, action, metadata: { reason: "rate_limit" } });
  return { ok: false, error: "RATE_LIMITED", retryAfter: res.retryAfterSec };
}

export async function enableTwoFactorAction(
  password: unknown,
): Promise<TwoFactorActionState<TwoFactorEnrolment>> {
  const user = await requireSession();
  if (typeof password !== "string" || !password) return { ok: false, error: "BAD_PASSWORD" };
  const headers = await authHeaders();
  return withPasswordLimit(user.id, "auth.2fa.enable_failed", () =>
    enableTwoFactor(headers, user.id, password),
  );
}

export async function disableTwoFactorAction(
  password: unknown,
  code: unknown,
): Promise<TwoFactorActionState<null>> {
  const user = await requireSession();
  if (typeof password !== "string" || !password) return { ok: false, error: "BAD_PASSWORD" };
  if (typeof code !== "string" || !code.trim()) return { ok: false, error: "BAD_CODE" };
  const headers = await authHeaders();
  return withPasswordLimit(user.id, "auth.2fa.disable_failed", () =>
    disableTwoFactor(headers, user.id, password, code),
  );
}

export async function regenerateBackupCodesAction(
  password: unknown,
  code: unknown,
): Promise<TwoFactorActionState<{ backupCodes: string[] }>> {
  const user = await requireSession();
  if (typeof password !== "string" || !password) return { ok: false, error: "BAD_PASSWORD" };
  if (typeof code !== "string" || !code.trim()) return { ok: false, error: "BAD_CODE" };
  const headers = await authHeaders();
  return withPasswordLimit(user.id, "auth.2fa.backup_codes_failed", () =>
    regenerateBackupCodes(headers, user.id, password, code),
  );
}

export type TrustedDeviceActionState =
  | { ok: true }
  | { ok: false; error: RevokeTrustedDeviceError | "INVALID" | "FAILED" };

export async function revokeTrustedDeviceAction(id: unknown): Promise<TrustedDeviceActionState> {
  const user = await requireSession();
  const parsed = revokeTrustedDeviceSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "INVALID" };
  return revokeTrustedDevice(user.id, parsed.data);
}

export async function revokeAllTrustedDevicesAction(): Promise<TrustedDeviceActionState> {
  const user = await requireSession();
  await revokeAllTrustedDevices(user.id);
  return { ok: true };
}
