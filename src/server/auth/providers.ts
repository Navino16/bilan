import type { PrismaClient, AuthProvider } from "@prisma/client";
import { db } from "@/server/db";
import { dataKey } from "@/server/crypto/keys";
import { decrypt } from "@/server/crypto/encryption";

export class DynamicProviderCache {
  private cache: { providers: AuthProvider[]; expiresAt: number } | null = null;

  constructor(
    private db: PrismaClient,
    private opts: { ttlMs: number } = { ttlMs: 60_000 },
  ) {}

  async get(): Promise<AuthProvider[]> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) return this.cache.providers;
    const providers = await this.db.authProvider.findMany({ where: { enabled: true } });
    this.cache = { providers, expiresAt: now + this.opts.ttlMs };
    return providers;
  }

  invalidate(): void {
    this.cache = null;
  }
}

export const providerCache = new DynamicProviderCache(db);

export type ResolvedOidc = {
  providerId: string;
  clientId: string;
  clientSecret: string;
  issuer: string;
  scopes: string[];
  pkce?: boolean;
  authorizationUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  mapName?: string;
  mapEmail?: string;
  allowSignUp: boolean;
};

type AdvancedConfig = {
  pkce?: boolean;
  authorizationUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  mapName?: string;
  mapEmail?: string;
};

/** Decrypt clientSecretEnc and merge the advanced `config` into a structure ready to feed Better Auth. */
export function resolveOidcProvider(row: AuthProvider): ResolvedOidc | null {
  if (row.type !== "oidc") return null;
  if (!row.issuer || !row.clientId || !row.clientSecretEnc) return null;
  const cfg = (row.config ?? {}) as AdvancedConfig;
  return {
    providerId: row.key,
    clientId: row.clientId,
    clientSecret: decrypt(row.clientSecretEnc, dataKey),
    issuer: row.issuer,
    scopes: row.scopes
      ? row.scopes.split(",").map((s) => s.trim())
      : ["openid", "email", "profile"],
    pkce: cfg.pkce,
    authorizationUrl: cfg.authorizationUrl,
    tokenUrl: cfg.tokenUrl,
    userInfoUrl: cfg.userInfoUrl,
    mapName: cfg.mapName,
    mapEmail: cfg.mapEmail,
    allowSignUp: row.allowSignUp,
  };
}
