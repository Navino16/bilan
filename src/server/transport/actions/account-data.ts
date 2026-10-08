"use server";

import { authHeaders } from "@/server/http/auth-headers";
import { requireSession } from "@/server/auth/permissions";
import { getAuth } from "@/server/auth";
import { db } from "@/server/db";
import { loginLimiter } from "@/server/auth/rate-limit";
import { deleteOwnAccount, UserAdminError } from "@/server/services/users/lifecycle";

export type AccountDataState = { ok: true } | { ok: false; error: string } | null;

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
    if (!password) return { ok: false, error: "INVALID" };
    // Rate-limits the password re-auth (own key in the login limiter).
    const bucket = loginLimiter.consume(`delete:${user.id}`);
    if (!bucket.allowed) return { ok: false, error: "RATE_LIMITED" };
    const auth = await getAuth();
    try {
      await auth.api.verifyPassword({ body: { password }, headers: await authHeaders() });
    } catch {
      return { ok: false, error: "BAD_PASSWORD" };
    }
  } else {
    const confirmEmail = String(formData.get("confirmEmail") ?? "")
      .trim()
      .toLowerCase();
    if (confirmEmail !== user.email.toLowerCase()) return { ok: false, error: "BAD_CONFIRM" };
  }

  try {
    await deleteOwnAccount(user.id);
  } catch (e) {
    return { ok: false, error: e instanceof UserAdminError ? e.code : "FAILED" };
  }
  return { ok: true };
}
