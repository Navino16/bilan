import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { changePasswordLimiter, withRefund } from "@/server/auth/rate-limit";
import { processState } from "@/server/process-state";
import { logEvent } from "@/server/services/audit";
import { appSettings } from "@/server/services/settings/app-settings";
import { hasPasswordCredential, isCurrentPassword } from "./password";

// Step-up for reading secrets (#257): a recent sign-in, or the password confirmed on this session.
export const RECENT_SIGN_IN_MS = 10 * 60_000;
export const STEP_UP_TTL_MS = 5 * 60_000;
const STEP_UP_PREFIX = "step-up-";

export type StepUpMethod = "PASSWORD" | "SIGN_IN";
export type StepUpVia = "recent_sign_in" | "password";
export type StepUpSession = { id: string; userId: string; createdAt: Date };
export type AuditOrigin = { ipAddress: string | null; userAgent: string | null };
export type AuditTarget = { action: string; entity?: string; entityId?: string };

export type StepUpConfirmResult =
  | { ok: true }
  | { ok: false; error: "BAD_PASSWORD" }
  | { ok: false; error: "REAUTH_REQUIRED"; method: "SIGN_IN" }
  | { ok: false; error: "RATE_LIMITED"; retryAfter: number };

export function isRecentSignIn(sessionCreatedAt: Date, now: number = Date.now()): boolean {
  return now - sessionCreatedAt.getTime() < RECENT_SIGN_IN_MS;
}

// Same rule as the 2FA exemption (permissions.ts requiresTwoFactorSetup): a password only
// re-authenticates while it can sign in; otherwise the user signs in again (SSO, passkey).
export async function stepUpMethod(userId: string): Promise<StepUpMethod> {
  const [passwordSignIn, hasPassword] = await Promise.all([
    appSettings.get<boolean>("credentials_enabled").then((v) => v ?? true),
    hasPasswordCredential(userId),
  ]);
  return passwordSignIn && hasPassword ? "PASSWORD" : "SIGN_IN";
}

// The password grant is a verification row keyed by the session id: it dies with the session
// and can't be carried to another one.
export async function stepUpVia(
  session: StepUpSession,
  now: Date = new Date(),
): Promise<StepUpVia | null> {
  if (isRecentSignIn(session.createdAt, now.getTime())) return "recent_sign_in";
  const grant = await db.verification.findFirst({
    where: {
      identifier: `${STEP_UP_PREFIX}${session.id}`,
      value: session.userId,
      expiresAt: { gt: now },
    },
    select: { id: true },
  });
  return grant ? "password" : null;
}

async function grantStepUp(session: StepUpSession, now: Date): Promise<void> {
  await db.verification.deleteMany({
    where: {
      value: session.userId,
      identifier: { startsWith: STEP_UP_PREFIX },
      OR: [{ identifier: `${STEP_UP_PREFIX}${session.id}` }, { expiresAt: { lte: now } }],
    },
  });
  await db.verification.create({
    data: {
      id: randomUUID(),
      identifier: `${STEP_UP_PREFIX}${session.id}`,
      value: session.userId,
      expiresAt: new Date(now.getTime() + STEP_UP_TTL_MS),
    },
  });
}

async function checkPassword(
  session: StepUpSession,
  password: string,
  target: AuditTarget,
  origin: AuditOrigin,
): Promise<StepUpConfirmResult> {
  if ((await stepUpMethod(session.userId)) === "SIGN_IN") {
    return { ok: false, error: "REAUTH_REQUIRED", method: "SIGN_IN" };
  }
  if (!(await isCurrentPassword(session.userId, password))) {
    await logEvent({
      ...target,
      ...origin,
      userId: session.userId,
      metadata: { reason: "bad_password" },
    });
    return { ok: false, error: "BAD_PASSWORD" };
  }
  await grantStepUp(session, new Date());
  return { ok: true };
}

// userId → end of the window whose rate-limit refusal is already audited.
const auditedRefusals = processState("step-up.rate-limit-audited", () => new Map<string, number>());

// Wrong passwords draw on the per-user bucket shared with password change and 2FA; a refusal
// is audited once per window so a scripted client can't flood the log.
export async function confirmStepUp(
  session: StepUpSession,
  password: string,
  target: AuditTarget,
  origin: AuditOrigin,
): Promise<StepUpConfirmResult> {
  const res = await withRefund(
    changePasswordLimiter,
    session.userId,
    () => checkPassword(session, password, target, origin),
    (r) => !r.ok && r.error === "BAD_PASSWORD",
  );
  if (res.allowed) return res.result;
  const now = Date.now();
  if ((auditedRefusals.get(session.userId) ?? 0) <= now) {
    auditedRefusals.set(session.userId, now + res.retryAfterSec * 1000);
    await logEvent({
      ...target,
      ...origin,
      userId: session.userId,
      metadata: { reason: "rate_limit" },
    });
  }
  return { ok: false, error: "RATE_LIMITED", retryAfter: res.retryAfterSec };
}
