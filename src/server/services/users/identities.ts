import type { PrismaClient } from "@prisma/client";
import { isAPIError } from "better-auth/api";
import { db } from "@/server/db";
import { isOriginError } from "@/lib/sso-errors";
import { getAuth } from "@/server/auth";
import { isServedProvider, providerCache } from "@/server/auth/providers";
import { logEvent } from "@/server/services/audit";
import {
  hasUsableSignIn,
  linkedProviderId,
  lockProviders,
  signInMethodsOf,
  signInUsability,
  type UserSignInMethods,
} from "@/server/services/settings/auth-providers";

/** What the sign-in buttons need about a provider; never its client id or secret. */
export type SsoProviderView = { providerId: string; kind: "google" | "oidc"; displayName: string };

export type IdentityView = {
  id: string;
  providerId: string;
  displayName: string;
  linkedAt: Date;
  providerEnabled: boolean;
  canUnlink: boolean;
};

export type IdentitiesView = { linked: IdentityView[]; linkable: SsoProviderView[] };

export async function listSsoProviders(
  opts: { signUpOnly?: boolean } = {},
): Promise<SsoProviderView[]> {
  const rows = await providerCache.get();
  return rows
    .filter((r) => isServedProvider(r) && (!opts.signUpOnly || r.allowSignUp))
    .map((r) => ({
      providerId: linkedProviderId(r)!,
      kind: r.type as SsoProviderView["kind"],
      displayName: r.displayName,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function withoutOne(methods: UserSignInMethods, providerId: string): UserSignInMethods {
  const i = methods.providerIds.indexOf(providerId);
  return { ...methods, providerIds: methods.providerIds.filter((_, j) => j !== i) };
}

export async function listIdentities(userId: string): Promise<IdentitiesView> {
  const [accounts, rows, methods, usable, providers] = await Promise.all([
    db.authAccount.findMany({
      where: { userId, providerId: { not: "credential" } },
      select: { id: true, providerId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    db.authProvider.findMany({ select: { type: true, key: true, displayName: true } }),
    signInMethodsOf([userId]),
    signInUsability(),
    listSsoProviders(),
  ]);
  const names = new Map(rows.map((r) => [linkedProviderId(r), r.displayName]));
  const own = methods.get(userId)!;
  return {
    linked: accounts.map((a) => ({
      id: a.id,
      providerId: a.providerId,
      displayName: names.get(a.providerId) ?? a.providerId,
      linkedAt: a.createdAt,
      providerEnabled: usable.enabledProviderIds.has(a.providerId),
      canUnlink: hasUsableSignIn(withoutOne(own, a.providerId), usable),
    })),
    linkable: providers.filter((p) => !accounts.some((a) => a.providerId === p.providerId)),
  };
}

/** Same rule as Better Auth's freshSessionMiddleware (session.freshAge, 1 day by default). */
export async function isFreshSession(createdAt: Date): Promise<boolean> {
  const { sessionConfig } = await (await getAuth()).$context;
  return (
    sessionConfig.freshAge === 0 || Date.now() - createdAt.getTime() < sessionConfig.freshAge * 1000
  );
}

export type LinkStartError = "UNAVAILABLE" | "ALREADY_LINKED" | "BAD_ORIGIN" | "FAILED";

type GenericOAuthApi = {
  oAuth2LinkAccount: (req: {
    body: { providerId: string; callbackURL: string; errorCallbackURL: string };
    headers: Headers;
  }) => Promise<{ url: string }>;
};

// The HTTP link endpoints stay disabled (#200); auth.api.* bypasses disabledPaths. The state
// cookie reaches the browser through nextCookies(), and the callback creates the AuthAccount row.
export async function startIdentityLink(
  headers: Headers,
  input: { userId: string; providerId: string; locale: string },
): Promise<{ ok: true; url: string } | { ok: false; error: LinkStartError }> {
  const provider = (await listSsoProviders()).find((p) => p.providerId === input.providerId);
  if (!provider) return { ok: false, error: "UNAVAILABLE" };
  const linked = await db.authAccount.count({
    where: { userId: input.userId, providerId: provider.providerId },
  });
  if (linked > 0) return { ok: false, error: "ALREADY_LINKED" };

  const back = `/${input.locale}/settings/security`;
  const urls = {
    callbackURL: `${back}?linked=${encodeURIComponent(provider.providerId)}`,
    errorCallbackURL: back,
  };
  const auth = await getAuth();
  try {
    const res =
      provider.kind === "google"
        ? await auth.api.linkSocialAccount({
            body: { provider: "google", ...urls, disableRedirect: true },
            headers,
          })
        : await (auth.api as unknown as GenericOAuthApi).oAuth2LinkAccount({
            body: { providerId: provider.providerId, ...urls },
            headers,
          });
    if (!res.url) return { ok: false, error: "FAILED" };
    return { ok: true, url: res.url };
  } catch (e) {
    if (isAPIError(e) && isOriginError(e.body?.code)) return { ok: false, error: "BAD_ORIGIN" };
    console.error("[bilan] identity link start failed", e);
    return { ok: false, error: "FAILED" };
  }
}

export type UnlinkError = "NOT_FOUND" | "LOCKOUT";

// Takes the provider lock used by deleteAuthProvider, then the user row: a concurrent unlink or
// provider deletion can't each assume the other identity still signs the user in (#163).
export async function unlinkIdentity(
  userId: string,
  accountId: string,
  database: PrismaClient = db,
): Promise<{ ok: true } | { ok: false; error: UnlinkError }> {
  const result = await database.$transaction(async (tx) => {
    await lockProviders(tx);
    await tx.$queryRaw`SELECT id FROM User WHERE id = ${userId} FOR UPDATE`;
    const account = await tx.authAccount.findFirst({
      where: { id: accountId, userId, providerId: { not: "credential" } },
      select: { id: true, providerId: true },
    });
    if (!account) return { ok: false, error: "NOT_FOUND" } as const;
    const [methods, usable] = await Promise.all([
      signInMethodsOf([userId], tx, account.id),
      signInUsability(tx),
    ]);
    if (!hasUsableSignIn(methods.get(userId)!, usable)) {
      return { ok: false, error: "LOCKOUT" } as const;
    }
    await tx.authAccount.delete({ where: { id: account.id } });
    return { ok: true, providerId: account.providerId } as const;
  });
  if (!result.ok) return result;
  await logEvent({
    userId,
    action: "auth.identity.unlinked",
    metadata: { providerId: result.providerId },
  });
  return { ok: true };
}
