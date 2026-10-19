import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { logEvent } from "@/server/services/audit";
import {
  stepUpMethod,
  stepUpVia,
  type AuditOrigin,
  type StepUpMethod,
  type StepUpSession,
} from "@/server/services/users/step-up";
import { formatIban } from "./iban";

export type IbanRevealResult =
  | { ok: true; iban: string }
  | { ok: false; error: "REAUTH_REQUIRED"; method: StepUpMethod }
  | { ok: false; error: "NOT_FOUND" };

export const ibanRevealFailure = (accountId: string) => ({
  action: "account.iban.reveal_failed",
  entity: "BankAccount",
  entityId: accountId,
});

// Owner only: people the account is shared with never see its IBAN. Outside the owner's
// full data export (also behind the step-up), the clear value only leaves the server here.
export async function revealAccountIban(input: {
  accountId: string;
  session: StepUpSession;
  origin: AuditOrigin;
}): Promise<IbanRevealResult> {
  const { accountId, session, origin } = input;
  const userId = session.userId;
  const acc = await db.bankAccount.findUnique({
    where: { id: accountId },
    select: { ownerId: true, ibanEnc: true },
  });
  if (!acc) return { ok: false, error: "NOT_FOUND" };
  if (acc.ownerId !== userId) {
    await logEvent({
      ...ibanRevealFailure(accountId),
      ...origin,
      userId,
      metadata: { reason: "not_owner" },
    });
    return { ok: false, error: "NOT_FOUND" };
  }
  if (!acc.ibanEnc) return { ok: false, error: "NOT_FOUND" };

  const via = await stepUpVia(session);
  if (!via) return { ok: false, error: "REAUTH_REQUIRED", method: await stepUpMethod(userId) };
  await logEvent({
    action: "account.iban.revealed",
    entity: "BankAccount",
    entityId: accountId,
    ...origin,
    userId,
    metadata: { via },
  });
  return { ok: true, iban: formatIban(decrypt(acc.ibanEnc, dataKey)) };
}
