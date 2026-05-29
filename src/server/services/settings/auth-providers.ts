import { z } from "zod";
import type { PrismaClient, AuthProvider } from "@prisma/client";
import { db } from "@/server/db";
import { encrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { invalidateAuthCache } from "@/server/auth";
import { logEvent } from "@/server/services/audit";

export const upsertSchema = z.object({
  id: z.string().optional(),
  key: z.string().min(1),
  type: z.enum(["credentials", "oidc", "google"]),
  displayName: z.string().min(1),
  enabled: z.boolean(),
  issuer: z.url().optional().nullable(),
  clientId: z.string().optional().nullable(),
  clientSecret: z.string().optional().nullable(),
  scopes: z.string().optional().nullable(),
});

export type UpsertInput = z.infer<typeof upsertSchema>;

export async function upsertAuthProvider(
  input: UpsertInput,
  actor: { id: string },
  database: PrismaClient = db,
): Promise<AuthProvider> {
  const parsed = upsertSchema.parse(input);
  const clientSecretEnc =
    parsed.clientSecret && parsed.clientSecret.length > 0
      ? encrypt(parsed.clientSecret, dataKey)
      : undefined;

  const row = await database.authProvider.upsert({
    where: { key: parsed.key },
    create: {
      key: parsed.key,
      type: parsed.type,
      displayName: parsed.displayName,
      enabled: parsed.enabled,
      issuer: parsed.issuer ?? null,
      clientId: parsed.clientId ?? null,
      clientSecretEnc: clientSecretEnc ?? null,
      scopes: parsed.scopes ?? null,
      updatedById: actor.id,
    },
    update: {
      type: parsed.type,
      displayName: parsed.displayName,
      enabled: parsed.enabled,
      issuer: parsed.issuer ?? null,
      clientId: parsed.clientId ?? null,
      ...(clientSecretEnc ? { clientSecretEnc } : {}),
      scopes: parsed.scopes ?? null,
      updatedById: actor.id,
    },
  });

  invalidateAuthCache();
  await logEvent({
    userId: actor.id,
    action: "settings.auth_provider.update",
    entity: "AuthProvider",
    entityId: row.id,
    metadata: { key: row.key, enabled: row.enabled },
  });
  return row;
}
