import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { logEvent } from "@/server/services/audit";
import { purgeTrustedDevices } from "./trusted-devices";

export type ChangePasswordError =
  | "BAD_PASSWORD"
  | "TOO_SHORT"
  | "TOO_LONG"
  | "REVOKE_FAILED"
  | "SAME_PASSWORD"
  | "FAILED";

export function isBadPassword(res: { ok: boolean; error?: string }): boolean {
  return !res.ok && res.error === "BAD_PASSWORD";
}

// SSO-only accounts have no credential row, so there is no password to change.
export async function hasPasswordCredential(userId: string): Promise<boolean> {
  const row = await db.authAccount.findFirst({
    where: { userId, providerId: "credential", password: { not: null } },
    select: { id: true },
  });
  return row !== null;
}

export async function isCurrentPassword(userId: string, password: string): Promise<boolean> {
  const account = await db.authAccount.findFirst({
    where: { userId, providerId: "credential" },
    select: { password: true },
  });
  if (!account?.password) return false;
  const ctx = await (await getAuth()).$context;
  return ctx.password.verify({ hash: account.password, password });
}

function auditBadPassword(userId: string) {
  return logEvent({
    userId,
    action: "auth.password.change_failed",
    metadata: { reason: "bad_password" },
  });
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
  const session = await auth.api.getSession({ headers });
  if (!session) return { ok: false, error: "FAILED" };
  const userId = session.user.id;
  const { revokeOtherSessions, ...body } = input;

  // Handled before better-auth so an unchanged password sends no security email (#172).
  if (body.newPassword === body.currentPassword) {
    if (await isCurrentPassword(userId, body.currentPassword))
      return { ok: false, error: "SAME_PASSWORD" };
    await auditBadPassword(userId);
    return { ok: false, error: "BAD_PASSWORD" };
  }

  try {
    await auth.api.changePassword({ body, headers });
  } catch (err) {
    const code = (err as { body?: { code?: string } }).body?.code;
    const mapped = code ? ERROR_BY_CODE[code] : undefined;
    if (!mapped) console.error("[bilan] changePassword failed", err);
    if (mapped === "BAD_PASSWORD") await auditBadPassword(userId);
    return { ok: false, error: mapped ?? "FAILED" };
  }
  if (revokeOtherSessions) {
    try {
      await auth.api.revokeOtherSessions({ headers });
    } catch (err) {
      console.error("[bilan] revokeOtherSessions failed", err);
      return { ok: false, error: "REVOKE_FAILED" };
    }
    await purgeTrustedDevices(userId);
  }
  return { ok: true };
}
