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
  // Advanced OIDC options (stored in the `config` JSON column). Endpoints are an
  // explicit fallback when the issuer's discovery document isn't usable; mapName
  // /mapEmail let the admin pick which userinfo claims map to name/email.
  pkce: z.boolean().optional(),
  authorizationUrl: z.url().optional().nullable(),
  tokenUrl: z.url().optional().nullable(),
  userInfoUrl: z.url().optional().nullable(),
  mapName: z.string().optional().nullable(),
  mapEmail: z.string().optional().nullable(),
});

export type UpsertInput = z.infer<typeof upsertSchema>;

/** Shape persisted in AuthProvider.config for OIDC advanced options. */
export type OidcAdvancedConfig = {
  pkce?: boolean;
  authorizationUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  mapName?: string;
  mapEmail?: string;
};

function buildAdvancedConfig(input: UpsertInput): OidcAdvancedConfig | null {
  const cfg: OidcAdvancedConfig = {};
  if (input.pkce) cfg.pkce = true;
  if (input.authorizationUrl) cfg.authorizationUrl = input.authorizationUrl;
  if (input.tokenUrl) cfg.tokenUrl = input.tokenUrl;
  if (input.userInfoUrl) cfg.userInfoUrl = input.userInfoUrl;
  if (input.mapName) cfg.mapName = input.mapName;
  if (input.mapEmail) cfg.mapEmail = input.mapEmail;
  return Object.keys(cfg).length > 0 ? cfg : null;
}

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
  const config = buildAdvancedConfig(parsed);

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
      config: config ?? undefined,
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
      config: config ?? undefined,
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
