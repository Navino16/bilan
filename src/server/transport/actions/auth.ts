"use server";

import { headers as nextHeaders } from "next/headers";
import { env } from "@/env";
import { getAuth } from "@/server/auth";
import { loginLimiter, registerLimiter, resetLimiter } from "@/server/auth/rate-limit";
import { appSettings } from "@/server/services/settings/app-settings";
import { consumeSignupToken, refundSignupToken } from "@/server/services/signup-tokens";
import { logEvent } from "@/server/services/audit";
import {
  loginSchema,
  registerSchema,
  resetRequestSchema,
  resetConfirmSchema,
} from "./auth-schemas";

export type AuthActionState =
  | { ok: true }
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

  const bucket = loginLimiter.consume(rlKey(parsed.data.email));
  if (!bucket.allowed) {
    await logEvent({ action: "auth.login.failed", metadata: { reason: "rate_limit" } });
    return { ok: false, error: "RATE_LIMITED", retryAfter: bucket.retryAfterSec };
  }

  try {
    const auth = await getAuth();
    await auth.api.signInEmail({ body: parsed.data, headers: await nextHeaders() });
    await logEvent({ action: "auth.login.success", metadata: { email: parsed.data.email } });
    return { ok: true };
  } catch {
    await logEvent({ action: "auth.login.failed", metadata: { email: parsed.data.email } });
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

  try {
    const auth = await getAuth();
    await auth.api.signUpEmail({
      body: { email: parsed.data.email, password: parsed.data.password, name: parsed.data.name },
      headers: await nextHeaders(),
    });
    await logEvent({ action: "auth.register.success", metadata: { email: parsed.data.email } });
    return { ok: true };
  } catch {
    // The signup failed (e.g. duplicate email, weak password), so give the
    // invite token its use back — otherwise a single-use invite is permanently
    // burned by a recoverable typo.
    if (consumedToken) await refundSignupToken(consumedToken);
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
  // The reset link is delivered by the sendResetPassword callback (dev console
  // only; the token is never persisted — real SMTP delivery lands in 8.4).
  try {
    const auth = await getAuth();
    await auth.api.requestPasswordReset({
      body: { email: parsed.data.email, redirectTo: `${env.APP_URL}/reset` },
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
    return { ok: true };
  } catch {
    return { ok: false, error: "INVALID_TOKEN" };
  }
}
