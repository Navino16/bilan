import { isAPIError } from "better-auth/api";
import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { isTwoFactorWriteConflict } from "@/server/auth/auth-errors";
import { logEvent } from "@/server/services/audit";
import { isCurrentPassword } from "./password";

export type TwoFactorError =
  | "BAD_PASSWORD"
  | "BAD_CODE"
  | "ALREADY_ENABLED"
  | "NOT_ENABLED"
  | "FAILED";
export type TwoFactorEnrolment = { totpURI: string; backupCodes: string[] };
type Result<T> = { ok: true; data: T } | { ok: false; error: TwoFactorError };

export type FailedAction = "auth.2fa.enable_failed" | "auth.2fa.disable_failed";

type PasswordInput = { body: { password: string }; headers: Headers };
type CodeInput = { body: { code: string }; headers: Headers };
// getAuth()'s type is built without the plugins, so it doesn't see the twoFactor endpoints.
type TwoFactorApi = {
  enableTwoFactor(input: PasswordInput): Promise<TwoFactorEnrolment>;
  disableTwoFactor(input: PasswordInput): Promise<{ status: boolean }>;
  verifyTOTP(input: CodeInput): Promise<unknown>;
  verifyBackupCode(input: CodeInput): Promise<unknown>;
};

async function twoFactorApi(): Promise<TwoFactorApi> {
  return (await getAuth()).api as unknown as TwoFactorApi;
}

async function twoFactorEnabled(userId: string): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { twoFactorEnabled: true },
  });
  return Boolean(user?.twoFactorEnabled);
}

async function badPassword(userId: string, action: FailedAction) {
  await logEvent({ userId, action, metadata: { reason: "bad_password" } });
  return { ok: false as const, error: "BAD_PASSWORD" as const };
}

async function failure(err: unknown, userId: string, action: FailedAction) {
  const code = (err as { body?: { code?: string } }).body?.code;
  if (code === "INVALID_PASSWORD") return badPassword(userId, action);
  console.error(`[bilan] ${action}`, err);
  return { ok: false as const, error: "FAILED" as const };
}

// Starts enrolment; `auth.2fa.enabled` is audited once the first TOTP code verifies.
// Re-enrolling would silently swap the secret and backup codes of an active 2FA (#243).
export async function enableTwoFactor(
  headers: Headers,
  userId: string,
  password: string,
): Promise<Result<TwoFactorEnrolment>> {
  if (await twoFactorEnabled(userId)) return { ok: false, error: "ALREADY_ENABLED" };
  const api = await twoFactorApi();
  try {
    const { totpURI, backupCodes } = await api.enableTwoFactor({ body: { password }, headers });
    return { ok: true, data: { totpURI, backupCodes } };
  } catch (err) {
    return failure(err, userId, "auth.2fa.enable_failed");
  }
}

// Statuses meaning "this code doesn't pass"; a 429 or 5xx is a failure, not the user's code.
const REFUSED_CODE = new Set([400, 401, 409]);

// A 6-digit code is a TOTP; anything else is tried as a backup code (consumed on success).
async function verifyCode(api: TwoFactorApi, headers: Headers, code: string): Promise<boolean> {
  const totp = code.replace(/\s/g, "");
  try {
    if (/^\d{6}$/.test(totp)) await api.verifyTOTP({ body: { code: totp }, headers });
    else await api.verifyBackupCode({ body: { code: code.trim() }, headers });
    return true;
  } catch (err) {
    if (isAPIError(err) && REFUSED_CODE.has(err.statusCode)) return false;
    if (isTwoFactorWriteConflict(err)) return false;
    throw err;
  }
}

// Decision S1 (#243): the password and a current TOTP or backup code. Success is audited
// (`auth.2fa.disabled` + alert mail) by the auth-audit after-hook.
export async function disableTwoFactor(
  headers: Headers,
  userId: string,
  password: string,
  code: string,
): Promise<Result<null>> {
  const action = "auth.2fa.disable_failed";
  if (!(await isCurrentPassword(userId, password))) return badPassword(userId, action);
  if (!(await twoFactorEnabled(userId))) return { ok: false, error: "NOT_ENABLED" };
  const api = await twoFactorApi();
  try {
    if (!(await verifyCode(api, headers, code))) {
      await logEvent({ userId, action, metadata: { reason: "bad_code" } });
      return { ok: false, error: "BAD_CODE" };
    }
    await api.disableTwoFactor({ body: { password }, headers });
    return { ok: true, data: null };
  } catch (err) {
    return failure(err, userId, action);
  }
}
