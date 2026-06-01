import { z } from "zod";
import type { PrismaClient, SmtpConfig } from "@prisma/client";
import { db } from "@/server/db";
import { encrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { logEvent } from "@/server/services/audit";

// A self-hosted instance has a single outgoing SMTP config, so it's stored as a
// singleton row under a fixed id.
export const SMTP_SINGLETON_ID = "default";

export const smtpSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean().default(true),
  username: z.string().min(1),
  password: z.string().min(1),
  fromAddress: z.email(),
  fromName: z.string().optional().nullable(),
  enabled: z.boolean().default(true),
});

export type SmtpInput = z.infer<typeof smtpSchema>;

export async function upsertSmtp(
  input: SmtpInput,
  actor: { id: string },
  database: PrismaClient = db,
): Promise<SmtpConfig> {
  const parsed = smtpSchema.parse(input);
  const passwordEnc = encrypt(parsed.password, dataKey);

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
