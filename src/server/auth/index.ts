import { betterAuth, type BetterAuthOptions } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { genericOAuth } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/server/db";
import { env } from "@/env";
import { dataKey } from "@/server/crypto/keys";
import { decrypt } from "@/server/crypto/encryption";
import { appSettings } from "@/server/services/settings/app-settings";
import { providerCache, resolveOidcProvider, type ResolvedOidc } from "./providers";
import { authPlugins } from "./plugins";

type Handler = ReturnType<typeof betterAuth>;
let cached: { handler: Handler; builtAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

// Map a resolved OIDC row to a generic-oauth config entry. discoveryUrl is the
// default; explicit endpoints (when set) override it. A claim mapping builds a
// mapProfileToUser so the admin can pick which userinfo claims feed name/email.
function toOAuthConfig(o: ResolvedOidc) {
  const mapProfileToUser =
    o.mapName || o.mapEmail
      ? (profile: Record<string, unknown>) => ({
          ...(o.mapName ? { name: profile[o.mapName] as string } : {}),
          ...(o.mapEmail ? { email: profile[o.mapEmail] as string } : {}),
        })
      : undefined;

  return {
    providerId: o.providerId,
    discoveryUrl: `${o.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
    clientId: o.clientId,
    clientSecret: o.clientSecret,
    scopes: o.scopes,
    ...(o.pkce ? { pkce: true } : {}),
    ...(o.authorizationUrl ? { authorizationUrl: o.authorizationUrl } : {}),
    ...(o.tokenUrl ? { tokenUrl: o.tokenUrl } : {}),
    ...(o.userInfoUrl ? { userInfoUrl: o.userInfoUrl } : {}),
    ...(mapProfileToUser ? { mapProfileToUser } : {}),
  };
}

async function buildOptions(): Promise<BetterAuthOptions> {
  const credentialsEnabled = (await appSettings.get<boolean>("credentials_enabled")) ?? true;
  const minPasswordLength = (await appSettings.get<number>("min_password_length")) ?? 12;
  const providers = await providerCache.get();

  // Compose enabled providers out of the DB: Google as a built-in social
  // provider, every "oidc" row as a generic-oauth config (one plugin, many
  // configs). Adding/enabling a row + invalidateAuthCache() hot-reloads them.
  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
  const oidcProviders: ResolvedOidc[] = [];
  for (const p of providers) {
    if (p.type === "google" && p.clientId && p.clientSecretEnc) {
      socialProviders.google = {
        clientId: p.clientId,
        clientSecret: decrypt(p.clientSecretEnc, dataKey),
      };
    }
    const oidc = resolveOidcProvider(p);
    if (oidc) oidcProviders.push(oidc);
  }

  const oidcPlugin =
    oidcProviders.length > 0 ? [genericOAuth({ config: oidcProviders.map(toOAuthConfig) })] : [];

  return {
    appName: "Bilan",
    secret: env.AUTH_SECRET,
    baseURL: env.APP_URL,
    trustedOrigins: [env.APP_URL],
    database: prismaAdapter(db, { provider: "mysql" }),
    // Map Better Auth's "account" model onto our renamed Prisma model
    // `AuthAccount` (delegate `authAccount`) — we keep BankAccount free of the
    // auth namespace. In better-auth >= 1.6 model renaming moved from the
    // adapter `schema` config to the top-level model options.
    account: { modelName: "authAccount" },
    emailAndPassword: {
      enabled: credentialsEnabled,
      minPasswordLength,
      autoSignIn: true,
    },
    socialProviders,
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // refresh after 1 day
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    advanced: {
      cookies: {
        sessionToken: { attributes: { sameSite: "strict", httpOnly: true } },
      },
    },
    // nextCookies() must be last: it sets Better Auth's Set-Cookie headers on
    // server-action / route-handler responses (so autoSignIn during setup
    // actually establishes the session in the browser).
    plugins: [...authPlugins, ...oidcPlugin, nextCookies()],
  };
}

export async function getAuth(): Promise<Handler> {
  const now = Date.now();
  if (cached && now - cached.builtAt < CACHE_TTL_MS) return cached.handler;
  const handler = betterAuth(await buildOptions());
  cached = { handler, builtAt: now };
  return handler;
}

export function invalidateAuthCache(): void {
  cached = null;
  providerCache.invalidate();
}
