import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { genericOAuth } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { getOAuthState } from "better-auth/api";
import { headers as nextHeaders } from "next/headers";
import { db } from "@/server/db";
import { env } from "@/env";
import { CLIENT_IP_HEADER, requestOrigin } from "@/server/http/client-ip";
import { processState } from "@/server/process-state";
import { requestLocale } from "@/server/http/request-locale";
import { dataKey } from "@/server/crypto/keys";
import { decrypt } from "@/server/crypto/encryption";
import {
  appSettings,
  getAppName,
  getMinPasswordLength,
} from "@/server/services/settings/app-settings";
import { logEvent } from "@/server/services/audit";
import { notifySecurityEvent } from "@/server/services/mail/security-notifications";
import { storeSignupLocale } from "@/server/services/users/preferences";
import { seedDefaultCategories } from "@/server/services/categories/seed-defaults";
import {
  isServedProvider,
  providerCache,
  resolveOidcProvider,
  type ResolvedOidc,
} from "./providers";
import { authPlugins } from "./plugins";
import { nameOnCreate, nameOnUpdate } from "./user-name";
import {
  RESET_TOKEN_TTL_SEC,
  resetLink,
  sendPasswordResetMail,
} from "@/server/services/mail/password-reset";

type Handler = ReturnType<typeof betterAuth>;
// Only the generation is process-wide: a shared handler would keep closures from a module
// copy that dev hot reload replaced. Each copy rebuilds its own handler once per invalidation.
const handlerGeneration = processState("auth.handler", () => ({ value: 0 }));
let cached: { handler: Handler; builtAt: number; generation: number } | null = null;
const CACHE_TTL_MS = 60_000;
const linkRequests = new WeakSet<object>();

// Map a resolved OIDC row to a generic-oauth config entry. discoveryUrl is the
// default; explicit endpoints (when set) override it. A claim mapping builds a
// mapProfileToUser so the admin can pick which userinfo claims feed name/email.
export function toOAuthConfig(o: ResolvedOidc, registrationOpen: boolean) {
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
    // Not disableImplicitSignUp: a client lifts that one with `requestSignUp: true` (#200).
    disableSignUp: !o.allowSignUp || !registrationOpen,
    ...(o.pkce ? { pkce: true } : {}),
    ...(o.authorizationUrl ? { authorizationUrl: o.authorizationUrl } : {}),
    ...(o.tokenUrl ? { tokenUrl: o.tokenUrl } : {}),
    ...(o.userInfoUrl ? { userInfoUrl: o.userInfoUrl } : {}),
    ...(mapProfileToUser ? { mapProfileToUser } : {}),
  };
}

function pluginEndpointPaths(pluginId: string): string[] {
  const plugin: BetterAuthPlugin | undefined = authPlugins.find((p) => p.id === pluginId);
  const paths: unknown[] = Object.values(plugin?.endpoints ?? {}).map((e) => e.path);
  if (paths.length === 0 || !paths.every((p): p is string => typeof p === "string")) {
    throw new Error(`[bilan] cannot list the ${pluginId} plugin endpoints to disable`);
  }
  return paths;
}

const ADMIN_PLUGIN_PATHS = pluginEndpointPaths("admin");

export async function buildOptions(): Promise<BetterAuthOptions> {
  const credentialsEnabled = (await appSettings.get<boolean>("credentials_enabled")) ?? true;
  // SSO sign-up also needs open registration: the IdP round trip can't carry an invite token.
  const registrationOpen = (await appSettings.get<string>("registration_mode")) === "OPEN";
  const minPasswordLength = await getMinPasswordLength();
  const appName = await getAppName();
  const providers = await providerCache.get();

  // Compose enabled providers out of the DB: Google as a built-in social
  // provider, every "oidc" row as a generic-oauth config (one plugin, many
  // configs). Adding/enabling a row + invalidateAuthCache() hot-reloads them.
  const socialProviders: Record<
    string,
    { clientId: string; clientSecret: string; disableSignUp: boolean; disableIdTokenSignIn: true }
  > = {};
  const oidcProviders: ResolvedOidc[] = [];
  for (const p of providers) {
    if (p.type === "google" && isServedProvider(p)) {
      socialProviders.google = {
        clientId: p.clientId,
        clientSecret: decrypt(p.clientSecretEnc, dataKey),
        disableSignUp: !p.allowSignUp || !registrationOpen,
        // POST /sign-in/social with an idToken ignores disableSignUp (#200); only the redirect flow is used.
        disableIdTokenSignIn: true,
      };
    }
    const oidc = resolveOidcProvider(p);
    if (oidc) oidcProviders.push(oidc);
  }

  const oidcPlugin =
    oidcProviders.length > 0
      ? [genericOAuth({ config: oidcProviders.map((o) => toOAuthConfig(o, registrationOpen)) })]
      : [];

  return {
    appName,
    secret: env.AUTH_SECRET,
    baseURL: env.APP_URL,
    trustedOrigins: [env.APP_URL],
    // Failed OAuth/OIDC callbacks (incl. a disabled account) land on the localized login
    // page — the proxy adds the locale — instead of Better Auth's English error page.
    onAPIError: { errorURL: `${env.APP_URL.replace(/\/$/, "")}/login` },
    // HTTP-only block: the router 404s these exact paths (no wildcards); auth.api.* still works.
    disabledPaths: [
      // Wrapped by Server Actions that add the registration mode, rate limits and audit (#197, #200).
      "/sign-up/email",
      "/verify-password",
      "/change-password",
      "/request-password-reset",
      "/reset-password",
      "/two-factor/enable",
      "/two-factor/disable",
      // Unused: arbitrary profile image/name, self-set impersonatedBy, credential removal,
      // password-gated 2FA secret/backup-code reads, email OTP (not configured) (#200).
      "/update-user",
      "/update-session",
      "/unlink-account",
      "/two-factor/get-totp-uri",
      "/two-factor/generate-backup-codes",
      "/two-factor/send-otp",
      "/two-factor/verify-otp",
      // Linking is explicit only: Settings > Security starts it through Server Actions (#200, #204).
      "/link-social",
      "/oauth2/link",
      // Unused, and they would hand IdP tokens or userinfo to the browser (#204).
      "/get-access-token",
      "/refresh-token",
      "/account-info",
      // The admin plugin is kept for its ban check; its endpoints would bypass app permissions,
      // the last-super-admin lock and audit (#200).
      ...ADMIN_PLUGIN_PATHS,
    ],
    // Rate limits and session IPs use the proxy-resolved IP, never a raw client header.
    advanced: { ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] } },
    database: prismaAdapter(db, { provider: "mysql" }),
    // Map Better Auth's "account" model onto our renamed Prisma model
    // `AuthAccount` (delegate `authAccount`) — we keep BankAccount free of the
    // auth namespace. In better-auth >= 1.6 model renaming moved from the
    // adapter `schema` config to the top-level model options.
    // No implicit linking by email: an SSO identity signs in only once linked or SSO-created (#200).
    account: { modelName: "authAccount", accountLinking: { disableImplicitLinking: true } },
    databaseHooks: {
      // Better Auth stores the /64 it rate-limits on; keep the full address, as security e-mails show it (#226).
      session: {
        create: {
          before: async (_session, ctx) => {
            const ip = ctx?.headers?.get(CLIENT_IP_HEADER);
            return ip ? { data: { ipAddress: ip } } : undefined;
          },
        },
      },
      user: {
        update: {
          before: async (data) => {
            const name = nameOnUpdate(data);
            return name ? { data: name } : undefined;
          },
        },
        create: {
          before: async (user) => ({ data: { ...user, ...nameOnCreate(user) } }),
          // Stores the signup page's locale and seeds the default categories in it; failures must
          // never block signup. No request context = adminCreateUser, which uses the admin's pick.
          after: async (user, ctx) => {
            if (!ctx) return;
            const locale = requestLocale(ctx.headers);
            await Promise.allSettled([
              storeSignupLocale(user.id, locale),
              seedDefaultCategories(user.id, locale),
            ]);
          },
        },
      },
      account: {
        // Link callbacks (Settings > Security, #204) create the row from the OAuth state's `link`.
        // Only create.before still runs inside the request state, so it flags the endpoint context.
        create: {
          before: async (account, ctx) => {
            if (!ctx) return;
            const state = await getOAuthState().catch(() => null);
            if (state?.link?.userId === account.userId) linkRequests.add(ctx);
          },
          after: async (account, ctx) => {
            if (!ctx || !linkRequests.delete(ctx)) return;
            try {
              await logEvent({
                userId: account.userId,
                action: "auth.identity.linked",
                metadata: { providerId: account.providerId },
              });
            } catch {
              // best-effort
            }
          },
        },
        update: {
          // A password change updates the credential row → audit + security alert. Resets go
          // through updateMany (the hook gets a row count, skipped here): see onPasswordReset.
          // Skipped for OIDC token refreshes. The mail is not awaited: SMTP can be slow.
          after: async (account, ctx) => {
            if (account.providerId !== "credential") return;
            try {
              await logEvent({ userId: account.userId, action: "auth.password.changed" });
              void notifySecurityEvent("password_changed", {
                userId: account.userId,
                at: new Date(),
                origin: ctx?.headers ? requestOrigin(ctx.headers) : undefined,
              });
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
      // Called once the reset password is stored. `request` is unset for Server Action calls.
      onPasswordReset: async ({ user }, request) => {
        try {
          await logEvent({ userId: user.id, action: "auth.password.changed" });
          void notifySecurityEvent("password_changed", {
            userId: user.id,
            at: new Date(),
            origin: requestOrigin(request?.headers ?? (await nextHeaders())),
          });
        } catch {
          // best-effort
        }
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
  const generation = handlerGeneration.value;
  if (cached && cached.generation === generation && now - cached.builtAt < CACHE_TTL_MS) {
    return cached.handler;
  }
  const handler = betterAuth(await buildOptions());
  // Built from settings read before an invalidateAuthCache(): use it once, don't cache it.
  if (handlerGeneration.value === generation) cached = { handler, builtAt: now, generation };
  return handler;
}

export function invalidateAuthCache(): void {
  cached = null;
  handlerGeneration.value += 1;
  providerCache.invalidate();
}
