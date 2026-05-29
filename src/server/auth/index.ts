import { betterAuth, type BetterAuthOptions } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "@/server/db";
import { env } from "@/env";
import { appSettings } from "@/server/services/settings/app-settings";
import { authPlugins } from "./plugins";

type Handler = ReturnType<typeof betterAuth>;
let cached: { handler: Handler; builtAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

async function buildOptions(): Promise<BetterAuthOptions> {
  const credentialsEnabled = (await appSettings.get<boolean>("credentials_enabled")) ?? true;
  const minPasswordLength = (await appSettings.get<number>("min_password_length")) ?? 12;

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
    plugins: authPlugins,
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
}
