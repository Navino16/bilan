import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { logEvent } from "@/server/services/audit";
import { appSettings } from "@/server/services/settings/app-settings";
import { hasPasswordCredential, isCurrentPassword } from "@/server/services/users/password";
import { formatIban } from "./iban";

// A session younger than this stands in for re-authentication (#257).
export const IBAN_REVEAL_WINDOW_MS = 10 * 60_000;

export type IbanReauthMethod = "PASSWORD" | "SIGN_IN";

export type IbanRevealResult =
  | { ok: true; iban: string }
  | { ok: false; error: "REAUTH_REQUIRED"; method: IbanReauthMethod }
  | { ok: false; error: "BAD_PASSWORD" | "NOT_FOUND" };

export function isRecentSignIn(sessionCreatedAt: Date, now: number = Date.now()): boolean {
  return now - sessionCreatedAt.getTime() < IBAN_REVEAL_WINDOW_MS;
}

// Same rule as the 2FA exemption (permissions.ts requiresTwoFactorSetup): a password only
// re-authenticates while it can sign in; otherwise the user signs in again (SSO, passkey).
export async function ibanReauthMethod(userId: string): Promise<IbanReauthMethod> {
  const [passwordSignIn, hasPassword] = await Promise.all([
    appSettings.get<boolean>("credentials_enabled").then((v) => v ?? true),
    hasPasswordCredential(userId),
  ]);
  return passwordSignIn && hasPassword ? "PASSWORD" : "SIGN_IN";
}

// Owner only: people the account is shared with never see its IBAN. The clear value
// only ever leaves the server through this call, and every reveal is audited.
export async function revealAccountIban(input: {
  accountId: string;
  userId: string;
  sessionCreatedAt: Date;
  password?: string;
}): Promise<IbanRevealResult> {
  const { accountId, userId } = input;
  const acc = await db.bankAccount.findUnique({
    where: { id: accountId },
    select: { ownerId: true, ibanEnc: true },
  });
  if (!acc || acc.ownerId !== userId || !acc.ibanEnc) return { ok: false, error: "NOT_FOUND" };

  const audit = { userId, entity: "BankAccount", entityId: accountId };
  let via: "recent_sign_in" | "password" = "recent_sign_in";
  if (!isRecentSignIn(input.sessionCreatedAt)) {
    const method = await ibanReauthMethod(userId);
    if (method === "SIGN_IN" || !input.password) {
      return { ok: false, error: "REAUTH_REQUIRED", method };
    }
    if (!(await isCurrentPassword(userId, input.password))) {
      await logEvent({
        ...audit,
        action: "account.iban.reveal_failed",
        metadata: { reason: "bad_password" },
      });
      return { ok: false, error: "BAD_PASSWORD" };
    }
    via = "password";
  }
  await logEvent({ ...audit, action: "account.iban.revealed", metadata: { via } });
  return { ok: true, iban: formatIban(decrypt(acc.ibanEnc, dataKey)) };
}
