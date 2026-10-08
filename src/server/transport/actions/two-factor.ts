"use server";

import { authHeaders } from "@/server/http/auth-headers";
import { requireSession } from "@/server/auth/permissions";
import { changePasswordLimiter } from "@/server/auth/rate-limit";
import { logEvent } from "@/server/services/audit";
import {
  disableTwoFactor,
  enableTwoFactor,
  type FailedAction,
  type TwoFactorEnrolment,
  type TwoFactorError,
} from "@/server/services/users/two-factor";

export type TwoFactorActionState<T> =
  | { ok: true; data: T }
  | { ok: false; error: TwoFactorError | "RATE_LIMITED"; retryAfter?: number };

// Shares the change-password bucket: every current-password check draws on one per-user budget.
async function rateLimited(
  userId: string,
  action: FailedAction,
): Promise<{ ok: false; error: "RATE_LIMITED"; retryAfter: number } | null> {
  const bucket = changePasswordLimiter.consume(userId);
  if (bucket.allowed) return null;
  await logEvent({ userId, action, metadata: { reason: "rate_limit" } });
  return { ok: false, error: "RATE_LIMITED", retryAfter: bucket.retryAfterSec };
}

export async function enableTwoFactorAction(
  password: unknown,
): Promise<TwoFactorActionState<TwoFactorEnrolment>> {
  const user = await requireSession();
  if (typeof password !== "string" || !password) return { ok: false, error: "BAD_PASSWORD" };
  const limited = await rateLimited(user.id, "auth.2fa.enable_failed");
  if (limited) return limited;
  return enableTwoFactor(await authHeaders(), user.id, password);
}

export async function disableTwoFactorAction(
  password: unknown,
): Promise<TwoFactorActionState<null>> {
  const user = await requireSession();
  if (typeof password !== "string" || !password) return { ok: false, error: "BAD_PASSWORD" };
  const limited = await rateLimited(user.id, "auth.2fa.disable_failed");
  if (limited) return limited;
  return disableTwoFactor(await authHeaders(), user.id, password);
}
