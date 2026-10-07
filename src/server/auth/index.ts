import { betterAuth, type BetterAuthOptions } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { genericOAuth } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/server/db";
import { env } from "@/env";
import { dataKey } from "@/server/crypto/keys";
import { decrypt } from "@/server/crypto/encryption";
import {
  appSettings,
  getAppName,
  getMinPasswordLength,
} from "@/server/services/settings/app-settings";
import { logEvent } from "@/server/services/audit";
import { notifyPasswordChanged } from "@/server/services/mail/security-notifications";
import { seedDefaultCategories } from "@/server/services/categories/seed-defaults";
import { providerCache, resolveOidcProvider, type ResolvedOidc } from "./providers";
import { authPlugins } from "./plugins";
import {
  RESET_TOKEN_TTL_SEC,
  resetLink,
  sendPasswordResetMail,
} from "@/server/services/mail/password-reset";

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
  const minPasswordLength = await getMinPasswordLength();
  const appName = await getAppName();
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
    appName,
    secret: env.AUTH_SECRET,
    baseURL: env.APP_URL,
    trustedOrigins: [env.APP_URL],
    database: prismaAdapter(db, { provider: "mysql" }),
    // Map Better Auth's "account" model onto our renamed Prisma model
    // `AuthAccount` (delegate `authAccount`) — we keep BankAccount free of the
    // auth namespace. In better-auth >= 1.6 model renaming moved from the
    // adapter `schema` config to the top-level model options.
    account: { modelName: "authAccount" },
    databaseHooks: {
      user: {
        create: {
          // Seed the default category set for every new account. Locale is not
          // known here (UserPreference is written separately) so default to fr;
          // failures must never block signup.
          after: async (user) => {
            try {
              await seedDefaultCategories(user.id, "fr");
            } catch {
              // best-effort
            }
          },
        },
      },
      account: {
        update: {
          // A credential account's row updates when the password is reset or
          // changed → audit + security alert. Skipped for OIDC token refreshes
          // (providerId !== "credential"). The mail is not awaited: SMTP can be slow.
          after: async (account) => {
            if (account.providerId !== "credential") return;
            try {
              const u = await db.user.findUnique({
                where: { id: account.userId },
                select: { email: true },
              });
              if (!u) return;
              await logEvent({ userId: account.userId, action: "auth.password.changed" });
              void notifyPasswordChanged({ email: u.email, at: new Date() });
            } catch {
              // best-effort
            }
          },
        },
      },
    },
    emailAndPassword: {
      enabled: credentialsEnabled,
      minPasswordLength,
      autoSignIn: true,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_SEC,
      // Not awaited: waiting on SMTP only for existing accounts would reveal them by timing.
      sendResetPassword: async ({ user, url, token }) => {
        await logEvent({ action: "auth.password.reset_requested", userId: user.id });
        const { link, locale, kind } = resetLink(url, token, env.APP_URL);
        void sendPasswordResetMail({ email: user.email, link, locale, kind }).catch((e) =>
          logEvent({
            action: "mail.security.failed",
            userId: user.id,
            metadata: { kind: "password_reset", error: e instanceof Error ? e.message : "unknown" },
          }),
        );
      },
    },
    // Reset tokens are credentials: keep only their hash in the verification table.
    verification: {
      storeIdentifier: { default: "plain", overrides: { "reset-password:": "hashed" } },
    },
    socialProviders,
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // refresh after 1 day
      // No cookie cache: a revoked session must stop working on its next request (#142).
      cookieCache: { enabled: false },
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
