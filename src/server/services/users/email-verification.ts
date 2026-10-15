import type { PrismaClient } from "@prisma/client";
import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import { createEmailVerificationToken } from "better-auth/api";
import { env } from "@/env";
import { isSmtpEnabled } from "@/server/services/settings/smtp";
import {
  auditVerificationMailFailure,
  deliverVerificationMail,
  VERIFY_TOKEN_TTL_SEC,
} from "@/server/services/mail/email-verification";

// Spec §6.12: what proved the address, kept in the audit metadata.
export type VerifiedVia = "link" | "password_reset" | "sso";

export async function markEmailVerified(
  userId: string,
  via: VerifiedVia,
  database: PrismaClient = db,
): Promise<boolean> {
  const { count } = await database.user.updateMany({
    where: { id: userId, emailVerified: false },
    data: { emailVerified: true },
  });
  if (count > 0) await logEvent({ userId, action: "auth.email.verified", metadata: { via } });
  return count > 0;
}

export async function isEmailVerified(userId: string, database: PrismaClient = db) {
  const user = await database.user.findUnique({
    where: { id: userId },
    select: { emailVerified: true },
  });
  return user?.emailVerified ?? false;
}

export type ResendVerificationResult = "SENT" | "ALREADY_VERIFIED" | "SMTP_DISABLED" | "FAILED";

// Mails the user's own stored address only; the public endpoint stays disabled (auth/index.ts).
// Same JWT as Better Auth's own links, so its /verify-email accepts it.
export async function resendVerificationEmail(userId: string): Promise<ResendVerificationResult> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true, name: true, emailVerified: true },
  });
  if (user.emailVerified) return "ALREADY_VERIFIED";
  if (!(await isSmtpEnabled())) return "SMTP_DISABLED";
  const token = await createEmailVerificationToken(
    env.AUTH_SECRET,
    user.email,
    undefined,
    VERIFY_TOKEN_TTL_SEC,
  );
  try {
    await deliverVerificationMail({ userId, email: user.email, name: user.name, token });
  } catch (e) {
    await auditVerificationMailFailure(userId, e);
    return "FAILED";
  }
  await logEvent({ userId, action: "auth.email.verification_sent" });
  return "SENT";
}
