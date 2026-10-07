"use server";

import { headers as nextHeaders } from "next/headers";
import { env } from "@/env";
import { isAPIError } from "better-auth/api";
import { getAuth } from "@/server/auth";
import { changePasswordLimiter, registerLimiter, resetLimiter } from "@/server/auth/rate-limit";
import { requireSession } from "@/server/auth/permissions";
import { appSettings } from "@/server/services/settings/app-settings";
import { consumeSignupToken, refundSignupToken } from "@/server/services/signup-tokens";
import { userExistsByEmail } from "@/server/services/users/lookup";
import { changePassword } from "@/server/services/users/password";
import { revokeOtherSessions, revokeSession } from "@/server/services/users/sessions";
import { logEvent } from "@/server/services/audit";
import {
  loginSchema,
  registerSchema,
  resetRequestSchema,
  resetConfirmSchema,
  changePasswordSchema,
  revokeSessionSchema,
} from "./auth-schemas";

export type AuthActionState =
  | { ok: true; twoFactor?: true }
  | { ok: false; error: string; retryAfter?: number }
  | null;

// Rate-limit key: the target account's email. X-Forwarded-For is client-
// spoofable without a trusted-proxy allowlist (a spoofed header would hand out a
// fresh bucket per request, defeating brute-force protection), so we key by the
// account being attacked — this is also the spec's "lockout after N fails" per
// account. IP-based limiting (credential-stuffing across accounts) needs
// trusted-proxy resolution and lands in scope 8.5.
function rlKey(email: string): string {
  return email.trim().toLowerCase();
}

export async function loginAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "INVALID" };

  // Rate limiting, audit and the new-login alert run in the Better Auth hooks
  // (login-guard.ts, auth-audit.ts) so direct API sign-ins get them too.
  try {
    const auth = await getAuth();
    const res = await auth.api.signInEmail({ body: parsed.data, headers: await nextHeaders() });
    if ("twoFactorRedirect" in res && res.twoFactorRedirect) return { ok: true, twoFactor: true };
    return { ok: true };
  } catch (e) {
    if (isAPIError(e) && e.body?.code === "RATE_LIMITED") {
      const retryAfter = (e.body as { retryAfter?: number }).retryAfter;
      return { ok: false, error: "RATE_LIMITED", retryAfter };
    }
    return { ok: false, error: "BAD_CREDENTIALS" };
  }
}

export async function registerAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "INVALID" };

  const bucket = registerLimiter.consume(rlKey(parsed.data.email));
  if (!bucket.allowed)
    return { ok: false, error: "RATE_LIMITED", retryAfter: bucket.retryAfterSec };

  // Enforce the configured registration mode — default-deny: anything that is
  // not explicitly OPEN or INVITE_ONLY (including an unexpected/corrupt value) is
  // treated as DISABLED.
  const mode = (await appSettings.get<string>("registration_mode")) ?? "INVITE_ONLY";
  let consumedToken: string | null = null;
  if (mode === "OPEN") {
    // no token required
  } else if (mode === "INVITE_ONLY") {
    const token = parsed.data.adminToken?.trim();
    if (!token) return { ok: false, error: "TOKEN_REQUIRED" };
    const consumed = await consumeSignupToken(token);
    if (!consumed.ok) return { ok: false, error: "BAD_TOKEN" };
    consumedToken = token;
  } else {
    return { ok: false, error: "DISABLED" };
  }

  // Whether the address already had an account before this attempt — used below
  // to tell whether a failed signup actually created a user, so a consumed
  // single-use invite is only refunded when this attempt created nothing.
  const emailExistedBefore = consumedToken ? await userExistsByEmail(parsed.data.email) : false;

  try {
    const auth = await getAuth();
    await auth.api.signUpEmail({
      body: { email: parsed.data.email, password: parsed.data.password, name: parsed.data.name },
      headers: await nextHeaders(),
    });
    await logEvent({ action: "auth.register.success", metadata: { email: parsed.data.email } });
    return { ok: true };
  } catch {
    // Signup failed (duplicate email, weak password, …). Refund the invite token
    // only if no user was created by THIS attempt — otherwise a recoverable typo
    // would permanently burn a single-use invite. If the user row was already
    // created before the throw, the token stays consumed (no double-use bypass).
    if (consumedToken) {
      const createdByThisAttempt =
        !emailExistedBefore && (await userExistsByEmail(parsed.data.email));
      if (!createdByThisAttempt) await refundSignupToken(consumedToken);
    }
    await logEvent({ action: "auth.register.failed", metadata: { email: parsed.data.email } });
    return { ok: false, error: "FAILED" };
  }
}

export async function resetRequestAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = resetRequestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "INVALID" };

  const bucket = resetLimiter.consume(rlKey(parsed.data.email));
  if (!bucket.allowed)
    return { ok: false, error: "RATE_LIMITED", retryAfter: bucket.retryAfterSec };

  // Always report success to avoid leaking whether the email is registered.
  // The sendResetPassword callback mails a link to `redirectTo/<token>`.
  try {
    const auth = await getAuth();
    const appUrl = env.APP_URL.replace(/\/$/, "");
    await auth.api.requestPasswordReset({
      body: { email: parsed.data.email, redirectTo: `${appUrl}/${parsed.data.locale}/reset` },
    });
  } catch {
    // swallow — do not reveal failures to the caller
  }
  return { ok: true };
}

export async function resetConfirmAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = resetConfirmSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "INVALID" };

  try {
    const auth = await getAuth();
    await auth.api.resetPassword({
      body: { token: parsed.data.token, newPassword: parsed.data.password },
    });
    await logEvent({ action: "auth.password.reset_completed" });
    // `auth.password.changed` + the security email are emitted by the
    // account.update databaseHook (fires for every credential password change).
    return { ok: true };
  } catch {
    return { ok: false, error: "INVALID_TOKEN" };
  }
}

export async function changePasswordAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const user = await requireSession();
  const parsed = changePasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const mismatch = parsed.error.issues.some((i) => i.message === "MISMATCH");
    return { ok: false, error: mismatch ? "MISMATCH" : "INVALID" };
  }

  const bucket = changePasswordLimiter.consume(user.id);
  if (!bucket.allowed) {
    await logEvent({
      userId: user.id,
      action: "auth.password.change_failed",
      metadata: { reason: "rate_limit" },
    });
    return { ok: false, error: "RATE_LIMITED", retryAfter: bucket.retryAfterSec };
  }

  const { currentPassword, newPassword, revokeOtherSessions } = parsed.data;
  const res = await changePassword(await nextHeaders(), {
    currentPassword,
    newPassword,
    revokeOtherSessions,
  });
  if (!res.ok && res.error === "BAD_PASSWORD")
    await logEvent({
      userId: user.id,
      action: "auth.password.change_failed",
      metadata: { reason: "bad_password" },
    });
  return res;
}

export async function revokeSessionAction(sessionId: string): Promise<AuthActionState> {
  await requireSession();
  const parsed = revokeSessionSchema.safeParse(sessionId);
  if (!parsed.success) return { ok: false, error: "INVALID" };
  const res = await revokeSession(await nextHeaders(), parsed.data);
  return res.ok ? { ok: true } : res;
}

export async function revokeOtherSessionsAction(): Promise<AuthActionState> {
  await requireSession();
  const res = await revokeOtherSessions(await nextHeaders());
  return res.ok ? { ok: true } : res;
}
