import { getAuth } from "@/server/auth";
import { logEvent } from "@/server/services/audit";

export type TwoFactorError = "BAD_PASSWORD" | "FAILED";
export type TwoFactorEnrolment = { totpURI: string; backupCodes: string[] };
type Result<T> = { ok: true; data: T } | { ok: false; error: TwoFactorError };

export type FailedAction = "auth.2fa.enable_failed" | "auth.2fa.disable_failed";

type PasswordInput = { body: { password: string }; headers: Headers };
// getAuth()'s type is built without the plugins, so it doesn't see the twoFactor endpoints.
type TwoFactorApi = {
  enableTwoFactor(input: PasswordInput): Promise<TwoFactorEnrolment>;
  disableTwoFactor(input: PasswordInput): Promise<{ status: boolean }>;
};

async function twoFactorApi(): Promise<TwoFactorApi> {
  return (await getAuth()).api as unknown as TwoFactorApi;
}

async function failure(err: unknown, userId: string, action: FailedAction) {
  const code = (err as { body?: { code?: string } }).body?.code;
  if (code === "INVALID_PASSWORD") {
    await logEvent({ userId, action, metadata: { reason: "bad_password" } });
    return { ok: false as const, error: "BAD_PASSWORD" as const };
  }
  console.error(`[bilan] ${action}`, err);
  return { ok: false as const, error: "FAILED" as const };
}

// Starts enrolment; `auth.2fa.enabled` is audited once the first TOTP code verifies.
export async function enableTwoFactor(
  headers: Headers,
  userId: string,
  password: string,
): Promise<Result<TwoFactorEnrolment>> {
  const api = await twoFactorApi();
  try {
    const { totpURI, backupCodes } = await api.enableTwoFactor({ body: { password }, headers });
    return { ok: true, data: { totpURI, backupCodes } };
  } catch (err) {
    return failure(err, userId, "auth.2fa.enable_failed");
  }
}

// Success is audited (`auth.2fa.disabled` + alert mail) by the auth-audit after-hook.
export async function disableTwoFactor(
  headers: Headers,
  userId: string,
  password: string,
): Promise<Result<null>> {
  const api = await twoFactorApi();
  try {
    await api.disableTwoFactor({ body: { password }, headers });
    return { ok: true, data: null };
  } catch (err) {
    return failure(err, userId, "auth.2fa.disable_failed");
  }
}
