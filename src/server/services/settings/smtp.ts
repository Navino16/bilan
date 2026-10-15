import { z } from "zod";
import type { PrismaClient, SmtpConfig } from "@prisma/client";
import { db } from "@/server/db";
import { encrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { logEvent } from "@/server/services/audit";
import { sendWithConfig } from "@/server/services/mail/mailer";

// A self-hosted instance has a single outgoing SMTP config, so it's stored as a
// singleton row under a fixed id.
export const SMTP_SINGLETON_ID = "default";

export const smtpSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean().default(true),
  username: z.string().min(1),
  // Empty keeps the stored password, but only for the same server and account (upsertSmtp).
  password: z.string(),
  fromAddress: z.email(),
  fromName: z.string().optional().nullable(),
  enabled: z.boolean().default(true),
});

export type SmtpInput = z.infer<typeof smtpSchema>;

export class SmtpPasswordRequiredError extends Error {
  constructor() {
    super("PASSWORD_REQUIRED");
  }
}

export async function upsertSmtp(
  input: SmtpInput,
  actor: { id: string },
  database: PrismaClient = db,
): Promise<SmtpConfig> {
  const parsed = smtpSchema.parse(input);
  let passwordEnc: string;
  if (parsed.password) {
    passwordEnc = encrypt(parsed.password, dataKey);
  } else {
    // Reusing the secret for another host/account would hand it to a server the admin
    // never typed it for.
    const existing = await getSmtpConfig(database);
    const sameServer =
      existing &&
      existing.host === parsed.host &&
      existing.port === parsed.port &&
      existing.username === parsed.username &&
      existing.secure === parsed.secure;
    if (!sameServer) throw new SmtpPasswordRequiredError();
    passwordEnc = existing.passwordEnc;
  }

  const data = {
    host: parsed.host,
    port: parsed.port,
    secure: parsed.secure,
    username: parsed.username,
    passwordEnc,
    fromAddress: parsed.fromAddress,
    fromName: parsed.fromName ?? null,
    enabled: parsed.enabled,
    updatedById: actor.id,
  };

  const row = await database.smtpConfig.upsert({
    where: { id: SMTP_SINGLETON_ID },
    create: { id: SMTP_SINGLETON_ID, ...data },
    update: data,
  });

  await logEvent({
    userId: actor.id,
    action: "settings.smtp.update",
    entity: "SmtpConfig",
    entityId: row.id,
    metadata: { host: row.host, enabled: row.enabled },
  });
  return row;
}

export function getSmtpConfig(database: PrismaClient = db): Promise<SmtpConfig | null> {
  return database.smtpConfig.findUnique({ where: { id: SMTP_SINGLETON_ID } });
}

export async function isSmtpEnabled(database: PrismaClient = db): Promise<boolean> {
  return (await getSmtpConfig(database))?.enabled ?? false;
}

export const SMTP_FAILURES = [
  "EAUTH",
  "ECONNECTION",
  "ETIMEDOUT",
  "ESOCKET",
  "EENVELOPE",
  "OTHER",
] as const;
export type SmtpFailure = (typeof SMTP_FAILURES)[number];

export function smtpFailureCode(error: unknown): SmtpFailure {
  const code = (error as { code?: unknown } | null)?.code;
  return SMTP_FAILURES.find((c) => c !== "OTHER" && c === code) ?? "OTHER";
}

export type SmtpTestResult =
  | { ok: true }
  | { ok: false; error: "NOT_CONFIGURED" }
  | { ok: false; error: "SEND_FAILED"; reason: SmtpFailure };

// Sends a test mail through the saved config, enabled or not, so the admin can
// validate it before switching it on. Only a coarse failure code is returned: the raw
// server reply would turn the test into a probe of arbitrary hosts (it is logged instead).
export async function sendSmtpTest(
  mail: { to: string; subject: string; text: string },
  actor: { id: string },
  database: PrismaClient = db,
): Promise<SmtpTestResult> {
  const cfg = await getSmtpConfig(database);
  if (!cfg) return { ok: false, error: "NOT_CONFIGURED" };
  let result: SmtpTestResult;
  try {
    await sendWithConfig(cfg, mail);
    result = { ok: true };
  } catch (e) {
    console.error("[bilan] SMTP test failed", e);
    result = { ok: false, error: "SEND_FAILED", reason: smtpFailureCode(e) };
  }
  await logEvent({
    userId: actor.id,
    action: "settings.smtp.test",
    entity: "SmtpConfig",
    entityId: cfg.id,
    metadata: {
      host: cfg.host,
      ok: result.ok,
      ...("reason" in result ? { reason: result.reason } : {}),
    },
  });
  return result;
}

export async function deleteSmtpConfig(
  actor: { id: string },
  database: PrismaClient = db,
): Promise<boolean> {
  const { count } = await database.smtpConfig.deleteMany({ where: { id: SMTP_SINGLETON_ID } });
  if (count > 0) {
    await logEvent({
      userId: actor.id,
      action: "settings.smtp.delete",
      entity: "SmtpConfig",
      entityId: SMTP_SINGLETON_ID,
    });
  }
  return count > 0;
}
