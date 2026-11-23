"use server";

import { authHeaders } from "@/server/http/auth-headers";
import { requireSession } from "@/server/auth/permissions";
import { getAuth } from "@/server/auth";
import { db } from "@/server/db";
import { loginLimiter } from "@/server/auth/rate-limit";
import { deleteOwnAccount, UserAdminError } from "@/server/services/users/lifecycle";
import { failureOnField, type FormFailure } from "@/lib/validation/field-errors";
import { currentStepUpSession } from "@/server/auth/step-up-session";
import { auditOrigin } from "@/server/http/audit-origin";
import { confirmStepUp, type StepUpConfirmResult } from "@/server/services/users/step-up";

export type AccountDataState = { ok: true } | FormFailure | null;

const ERROR_FIELDS = {
  REQUIRED: "password",
  BAD_PASSWORD: "password",
  BAD_CONFIRM: "confirmEmail",
};

export async function deleteAccountAction(
  _prev: AccountDataState,
  formData: FormData,
): Promise<AccountDataState> {
  const user = await requireSession();

  // Password-credential accounts re-auth with their password; SSO-only accounts
  // (no credential row) confirm by typing their exact email instead — otherwise
  // RGPD erasure would be impossible for them.
  const credential = await db.authAccount.findFirst({
    where: { userId: user.id, providerId: "credential" },
    select: { id: true },
  });

  if (credential) {
    const password = String(formData.get("password") ?? "");
    if (!password) return failureOnField({ ok: false, error: "REQUIRED" }, ERROR_FIELDS);
    // Rate-limits the password re-auth (own key in the login limiter).
    const bucket = loginLimiter.consume(`delete:${user.id}`);
    if (!bucket.allowed) return { ok: false, error: "RATE_LIMITED" };
    const auth = await getAuth();
    try {
      await auth.api.verifyPassword({ body: { password }, headers: await authHeaders() });
    } catch {
      return failureOnField({ ok: false, error: "BAD_PASSWORD" }, ERROR_FIELDS);
    }
  } else {
    const confirmEmail = String(formData.get("confirmEmail") ?? "")
      .trim()
      .toLowerCase();
    if (confirmEmail !== user.email.toLowerCase())
      return failureOnField({ ok: false, error: "BAD_CONFIRM" }, ERROR_FIELDS);
  }

  try {
    await deleteOwnAccount(user.id);
  } catch (e) {
    return { ok: false, error: e instanceof UserAdminError ? e.code : "FAILED" };
  }
  return { ok: true };
}

// Confirms the password before GET /api/export/data, which then passes for a few minutes.
export async function confirmDataExportAction(
  password: unknown,
): Promise<StepUpConfirmResult | { ok: false; error: "FAILED" }> {
  await requireSession();
  const session = await currentStepUpSession();
  if (!session) return { ok: false, error: "FAILED" };
  if (typeof password !== "string" || !password) return { ok: false, error: "BAD_PASSWORD" };
  const target = { action: "user.data.export_failed", entity: "User", entityId: session.userId };
  return confirmStepUp(session, password, target, await auditOrigin());
}
