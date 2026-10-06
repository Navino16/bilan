import { db } from "@/server/db";
import { getAuth } from "@/server/auth";

export type ChangePasswordError =
  | "BAD_PASSWORD"
  | "TOO_SHORT"
  | "TOO_LONG"
  | "REVOKE_FAILED"
  | "FAILED";

// SSO-only accounts have no credential row, so there is no password to change.
export async function hasPasswordCredential(userId: string): Promise<boolean> {
  const row = await db.authAccount.findFirst({
    where: { userId, providerId: "credential", password: { not: null } },
    select: { id: true },
  });
  return row !== null;
}

const ERROR_BY_CODE: Record<string, ChangePasswordError> = {
  INVALID_PASSWORD: "BAD_PASSWORD",
  PASSWORD_TOO_SHORT: "TOO_SHORT",
  PASSWORD_TOO_LONG: "TOO_LONG",
};

// The `auth.password.changed` audit + security email come from the
// account.update databaseHook in src/server/auth/index.ts.
// Other sessions are revoked separately: changePassword's own revokeOtherSessions
// rotates the current session cookie, which the post-action render can't see yet.
export async function changePassword(
  headers: Headers,
  input: { currentPassword: string; newPassword: string; revokeOtherSessions: boolean },
): Promise<{ ok: true } | { ok: false; error: ChangePasswordError }> {
  const auth = await getAuth();
  const { revokeOtherSessions, ...body } = input;
  try {
    await auth.api.changePassword({ body, headers });
  } catch (err) {
    const code = (err as { body?: { code?: string } }).body?.code;
    const mapped = code ? ERROR_BY_CODE[code] : undefined;
    if (!mapped) console.error("[bilan] changePassword failed", err);
    return { ok: false, error: mapped ?? "FAILED" };
  }
  if (revokeOtherSessions) {
    try {
      await auth.api.revokeOtherSessions({ headers });
    } catch (err) {
      console.error("[bilan] revokeOtherSessions failed", err);
      return { ok: false, error: "REVOKE_FAILED" };
    }
  }
  return { ok: true };
}
