import { z } from "zod";
import { Prisma, type PrismaClient, type AuthProvider } from "@prisma/client";
import { db } from "@/server/db";
import { encrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { PROVIDER_KEY_MAX, PROVIDER_TEXT_MAX } from "@/lib/validation/auth-provider";
import { invalidateAuthCache } from "@/server/auth";
import { isServedProvider } from "@/server/auth/providers";
import { logEvent } from "@/server/services/audit";
import { appSettings } from "@/server/services/settings/app-settings";

// The key becomes the OAuth providerId (callback path, AuthAccount.providerId);
// "credential" is Better Auth's providerId for password accounts.
const RESERVED_KEYS = ["credential"];

export const providerSchema = z
  .object({
    key: z
      .string()
      .trim()
      .max(PROVIDER_KEY_MAX)
      .regex(/^[a-z0-9][a-z0-9_-]*$/)
      .refine((k) => !RESERVED_KEYS.includes(k)),
    // Password sign-in is the `credentials_enabled` app setting, not a provider row.
    type: z.enum(["oidc", "google"]),
    displayName: z.string().trim().min(1).max(100),
    enabled: z.boolean(),
    issuer: z.string().trim().max(PROVIDER_TEXT_MAX).pipe(z.url()).optional().nullable(),
    clientId: z.string().trim().max(PROVIDER_TEXT_MAX).optional().nullable(),
    clientSecret: z.string().optional().nullable(),
    scopes: z.string().max(PROVIDER_TEXT_MAX).optional().nullable(),
    // Advanced OIDC options (stored in the `config` JSON column). Endpoints are an
    // explicit fallback when the issuer's discovery document isn't usable; mapName
    // /mapEmail let the admin pick which userinfo claims map to name/email.
    pkce: z.boolean().optional(),
    authorizationUrl: z.url().optional().nullable(),
    tokenUrl: z.url().optional().nullable(),
    userInfoUrl: z.url().optional().nullable(),
    mapName: z.string().optional().nullable(),
    mapEmail: z.string().optional().nullable(),
    allowSignUp: z.boolean().optional(),
  })
  .superRefine((p, ctx) => {
    // Better Auth's built-in Google provider owns the "google" providerId.
    if (p.key === "google" && p.type !== "google") ctx.addIssue({ code: "custom", path: ["key"] });
    if (p.type === "oidc" && !p.issuer) ctx.addIssue({ code: "custom", path: ["issuer"] });
    if (!p.clientId) ctx.addIssue({ code: "custom", path: ["clientId"] });
  });

export type ProviderInput = z.input<typeof providerSchema>;
type ParsedProvider = z.output<typeof providerSchema>;

export type AuthProviderErrorCode =
  | "KEY_EXISTS"
  | "GOOGLE_EXISTS"
  | "NOT_FOUND"
  | "SECRET_REQUIRED"
  | "TYPE_LOCKED"
  | "LOCKOUT";

export class AuthProviderError extends Error {
  constructor(
    public code: AuthProviderErrorCode,
    public count?: number,
  ) {
    super(code);
  }
}

/** Shape persisted in AuthProvider.config for OIDC advanced options. */
export type OidcAdvancedConfig = {
  pkce?: boolean;
  authorizationUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  mapName?: string;
  mapEmail?: string;
};

function buildAdvancedConfig(input: ParsedProvider): OidcAdvancedConfig | null {
  const cfg: OidcAdvancedConfig = {};
  if (input.pkce) cfg.pkce = true;
  if (input.authorizationUrl) cfg.authorizationUrl = input.authorizationUrl;
  if (input.tokenUrl) cfg.tokenUrl = input.tokenUrl;
  if (input.userInfoUrl) cfg.userInfoUrl = input.userInfoUrl;
  if (input.mapName) cfg.mapName = input.mapName;
  if (input.mapEmail) cfg.mapEmail = input.mapEmail;
  return Object.keys(cfg).length > 0 ? cfg : null;
}

/**
 * All configured providers (incl. disabled), for the admin list — unlike the
 * enabled-only `providerCache` that feeds the live auth handler.
 */
export function listAuthProviders(database: PrismaClient = db): Promise<AuthProvider[]> {
  return database.authProvider.findMany({ orderBy: { displayName: "asc" } });
}

// AuthAccount.providerId of the users signed in through this row (see server/auth buildOptions).
export function linkedProviderId(row: Pick<AuthProvider, "type" | "key">): string | null {
  if (row.type === "google") return "google";
  if (row.type === "oidc") return row.key;
  return null;
}

export type UserSignInMethods = {
  providerIds: string[];
  hasPassword: boolean;
  hasPasskey: boolean;
};

export type SignInUsability = {
  credentialsEnabled: boolean;
  enabledProviderIds: ReadonlySet<string>;
};

// A password only counts while credentials login is enabled; a provider only while its row is enabled.
export function hasUsableSignIn(u: UserSignInMethods, usable: SignInUsability): boolean {
  return (
    (u.hasPassword && usable.credentialsEnabled) ||
    u.hasPasskey ||
    u.providerIds.some((id) => usable.enabledProviderIds.has(id))
  );
}

// Users left with no usable sign-in method once `removed` goes away.
// Banned users are counted too: a ban is reversible.
export function countLockouts(
  users: UserSignInMethods[],
  removed: string,
  usable: SignInUsability,
): number {
  return users.filter(
    (u) =>
      !hasUsableSignIn({ ...u, providerIds: u.providerIds.filter((id) => id !== removed) }, usable),
  ).length;
}

// Users left with no usable sign-in method once password sign-in is turned off.
export function countCredentialLockouts(
  users: UserSignInMethods[],
  usable: SignInUsability,
): number {
  const off = { ...usable, credentialsEnabled: false };
  return users.filter((u) => u.hasPassword && !hasUsableSignIn(u, off)).length;
}

export type AuthProviderImpact = { linkedAccounts: number; lockedOut: number };

type Client = Prisma.TransactionClient | PrismaClient;

// Serialises provider deletions, Google creations and identity unlinks so their checks can't race.
export async function lockProviders(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT id FROM AuthProvider FOR UPDATE`;
}

export async function signInUsability(
  database: Client = db,
  excludeRowId?: string,
): Promise<SignInUsability> {
  const [rows, credentialsEnabled] = await Promise.all([
    database.authProvider.findMany({
      where: { enabled: true, ...(excludeRowId ? { id: { not: excludeRowId } } : {}) },
      select: { type: true, key: true, issuer: true, clientId: true, clientSecretEnc: true },
    }),
    appSettings.get<boolean>("credentials_enabled"),
  ]);
  return {
    credentialsEnabled: credentialsEnabled ?? true,
    enabledProviderIds: new Set(
      rows
        .filter(isServedProvider)
        .map(linkedProviderId)
        .filter((id): id is string => !!id),
    ),
  };
}

/** Sign-in methods per user, as if the `excludeAccountId` AuthAccount row were already gone. */
export async function signInMethodsOf(
  userIds: string[],
  database: Client = db,
  excludeAccountId?: string,
): Promise<Map<string, UserSignInMethods>> {
  const [accounts, passkeys] = await Promise.all([
    database.authAccount.findMany({
      where: {
        userId: { in: userIds },
        ...(excludeAccountId ? { id: { not: excludeAccountId } } : {}),
      },
      select: { userId: true, providerId: true, password: true },
    }),
    database.passkey.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true },
      distinct: ["userId"],
    }),
  ]);
  const withPasskey = new Set(passkeys.map((p) => p.userId));
  return new Map(
    userIds.map((userId) => {
      const own = accounts.filter((a) => a.userId === userId);
      return [
        userId,
        {
          providerIds: own.map((a) => a.providerId),
          hasPassword: own.some((a) => a.providerId === "credential" && !!a.password),
          hasPasskey: withPasskey.has(userId),
        },
      ];
    }),
  );
}

export async function authProviderImpact(
  row: Pick<AuthProvider, "id" | "type" | "key">,
  database: Client = db,
): Promise<AuthProviderImpact> {
  const providerId = linkedProviderId(row);
  if (!providerId) return { linkedAccounts: 0, lockedOut: 0 };
  const linked = await database.authAccount.findMany({
    where: { providerId },
    select: { userId: true },
  });
  if (linked.length === 0) return { linkedAccounts: 0, lockedOut: 0 };
  const userIds = [...new Set(linked.map((a) => a.userId))];
  const [methods, usable] = await Promise.all([
    signInMethodsOf(userIds, database),
    signInUsability(database, row.id),
  ]);
  return {
    linkedAccounts: linked.length,
    lockedOut: countLockouts([...methods.values()], providerId, usable),
  };
}

// Better Auth's Google provider only takes the client ID and secret.
function columns(p: ParsedProvider, actorId: string) {
  const oidc = p.type === "oidc";
  return {
    displayName: p.displayName,
    enabled: p.enabled,
    issuer: oidc ? (p.issuer ?? null) : null,
    clientId: p.clientId || null,
    scopes: oidc ? p.scopes || null : null,
    config: (oidc && buildAdvancedConfig(p)) || Prisma.DbNull,
    allowSignUp: p.allowSignUp ?? false,
    updatedById: actorId,
  };
}

function auditFields(row: AuthProvider, actor: { id: string }) {
  return {
    userId: actor.id,
    entity: "AuthProvider",
    entityId: row.id,
    metadata: { key: row.key, enabled: row.enabled, allowSignUp: row.allowSignUp },
  };
}

export async function createAuthProvider(
  input: ProviderInput,
  actor: { id: string },
  database: PrismaClient = db,
): Promise<AuthProvider> {
  const parsed = providerSchema.parse(input);
  if (!parsed.clientSecret) throw new AuthProviderError("SECRET_REQUIRED");
  let row: AuthProvider;
  try {
    row = await database.$transaction(async (tx) => {
      if (parsed.type === "google") {
        await lockProviders(tx);
        if ((await tx.authProvider.count({ where: { type: "google" } })) > 0) {
          throw new AuthProviderError("GOOGLE_EXISTS");
        }
      }
      return tx.authProvider.create({
        data: {
          key: parsed.key,
          type: parsed.type,
          ...columns(parsed, actor.id),
          clientSecretEnc: parsed.clientSecret ? encrypt(parsed.clientSecret, dataKey) : null,
        },
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new AuthProviderError("KEY_EXISTS");
    }
    throw e;
  }
  invalidateAuthCache();
  await logEvent({ ...auditFields(row, actor), action: "settings.auth_provider.create" });
  return row;
}

// The type is immutable: changing it would cut linked users off, bypassing the delete guard.
// An empty client secret keeps the stored one.
export async function updateAuthProvider(
  input: ProviderInput,
  actor: { id: string },
  database: PrismaClient = db,
): Promise<AuthProvider> {
  const parsed = providerSchema.parse(input);
  const existing = await database.authProvider.findUnique({ where: { key: parsed.key } });
  if (!existing) throw new AuthProviderError("NOT_FOUND");
  if (existing.type !== parsed.type) throw new AuthProviderError("TYPE_LOCKED");
  if (!parsed.clientSecret && !existing.clientSecretEnc) {
    throw new AuthProviderError("SECRET_REQUIRED");
  }
  let row: AuthProvider;
  try {
    row = await database.authProvider.update({
      where: { key: parsed.key },
      data: {
        ...columns(parsed, actor.id),
        ...(parsed.clientSecret ? { clientSecretEnc: encrypt(parsed.clientSecret, dataKey) } : {}),
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      throw new AuthProviderError("NOT_FOUND");
    }
    throw e;
  }
  invalidateAuthCache();
  await logEvent({ ...auditFields(row, actor), action: "settings.auth_provider.update" });
  return row;
}

export async function credentialLockouts(database: Client = db): Promise<number> {
  const withPassword = await database.authAccount.findMany({
    where: { providerId: "credential", password: { not: null } },
    select: { userId: true },
    distinct: ["userId"],
  });
  if (withPassword.length === 0) return 0;
  const [methods, usable] = await Promise.all([
    signInMethodsOf(
      withPassword.map((a) => a.userId),
      database,
    ),
    signInUsability(database),
  ]);
  return countCredentialLockouts([...methods.values()], usable);
}

// Runs `write`, which turns password sign-in off, under the provider lock like a deletion;
// refused when a user would be left with no usable sign-in method.
export async function disableCredentialsGuarded<T>(
  write: () => Promise<T>,
  database: PrismaClient = db,
): Promise<T> {
  if ((await appSettings.get<boolean>("credentials_enabled")) === false) return write();
  return database.$transaction(async (tx) => {
    await lockProviders(tx);
    const lockedOut = await credentialLockouts(tx);
    if (lockedOut > 0) throw new AuthProviderError("LOCKOUT", lockedOut);
    return write();
  });
}

// Refused when a linked user would have no other usable sign-in method (#163 decision B);
// the others only lose this method, and their links to it go with the provider.
export async function deleteAuthProvider(
  key: string,
  actor: { id: string },
  database: PrismaClient = db,
): Promise<void> {
  const { row, impact } = await database.$transaction(async (tx) => {
    await lockProviders(tx);
    const row = await tx.authProvider.findUnique({ where: { key } });
    if (!row) throw new AuthProviderError("NOT_FOUND");
    const impact = await authProviderImpact(row, tx);
    if (impact.lockedOut > 0) throw new AuthProviderError("LOCKOUT", impact.lockedOut);
    const providerId = linkedProviderId(row);
    if (providerId) await tx.authAccount.deleteMany({ where: { providerId } });
    await tx.authProvider.delete({ where: { key } });
    return { row, impact };
  });
  invalidateAuthCache();
  await logEvent({
    ...auditFields(row, actor),
    action: "settings.auth_provider.delete",
    metadata: { key: row.key, unlinkedAccounts: impact.linkedAccounts },
  });
}
