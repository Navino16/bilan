import type { PrismaClient, AuthProvider } from "@prisma/client";
import { db } from "@/server/db";
import { dataKey } from "@/server/crypto/keys";
import { decrypt } from "@/server/crypto/encryption";
import { processState } from "@/server/process-state";

type ProviderCacheStore = {
  entry: { providers: AuthProvider[]; expiresAt: number } | null;
  generation: number;
};

export class DynamicProviderCache {
  constructor(
    private db: PrismaClient,
    private opts: { ttlMs: number } = { ttlMs: 60_000 },
    private store: ProviderCacheStore = { entry: null, generation: 0 },
  ) {}

  async get(): Promise<AuthProvider[]> {
    const now = Date.now();
    const cached = this.store.entry;
    if (cached && cached.expiresAt > now) return cached.providers;
    const generation = this.store.generation;
    const providers = await this.db.authProvider.findMany({ where: { enabled: true } });
    // A read that raced an invalidate() may be stale: serve it, but don't cache it.
    if (this.store.generation === generation) {
      this.store.entry = { providers, expiresAt: now + this.opts.ttlMs };
    }
    return providers;
  }

  invalidate(): void {
    this.store.entry = null;
    this.store.generation += 1;
  }
}

export const providerCache = new DynamicProviderCache(
  db,
  undefined,
  processState<ProviderCacheStore>("auth.providers", () => ({ entry: null, generation: 0 })),
);

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

/** Whether the auth handler can serve this SSO row: it has the credentials its type needs. */
export function isServedProvider<
  T extends Pick<AuthProvider, "type" | "issuer" | "clientId" | "clientSecretEnc">,
>(row: T): row is T & { clientId: string; clientSecretEnc: string } {
  if (!row.clientId || !row.clientSecretEnc) return false;
  return row.type === "google" || (row.type === "oidc" && !!row.issuer);
}

/** Decrypt clientSecretEnc and merge the advanced `config` into a structure ready to feed Better Auth. */
export function resolveOidcProvider(row: AuthProvider): ResolvedOidc | null {
  if (row.type !== "oidc" || !isServedProvider(row)) return null;
  const cfg = (row.config ?? {}) as AdvancedConfig;
  return {
    providerId: row.key,
    clientId: row.clientId,
    clientSecret: decrypt(row.clientSecretEnc, dataKey),
    issuer: row.issuer!,
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
