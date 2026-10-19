import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

import { db } from "@/server/db";
import type { ProviderInput } from "@/server/services/settings/auth-providers";
import { snapshotSetting } from "./support/app-setting-snapshot";

// A production build loads these modules once per route (#208); vi.resetModules() mimics that.
async function loadRouteInstance() {
  vi.resetModules();
  return {
    auth: await import("@/server/auth"),
    providers: await import("@/server/auth/providers"),
    settings: await import("@/server/services/settings/app-settings"),
    admin: await import("@/server/services/settings/auth-providers"),
    rateLimit: await import("@/server/auth/rate-limit"),
  };
}
type RouteInstance = Awaited<ReturnType<typeof loadRouteInstance>>;

const tag = "shared-caches";
const actorId = `${tag}-actor`;
const providerKey = `${tag}-oidc`;

const provider = (enabled: boolean): ProviderInput => ({
  key: providerKey,
  type: "oidc",
  displayName: providerKey,
  enabled,
  issuer: "https://idp.shared-caches.test",
  clientId: "client",
  clientSecret: "secret",
});

// The test issuer has no discovery document, so Better Auth keeps the OIDC config pending
// rather than listing it among the social providers.
async function handlerProviderIds(route: RouteInstance) {
  const ctx = await (await route.auth.getAuth()).$context;
  const generic = ctx.options.plugins?.find((p) => p.id === "generic-oauth") as
    | { options: { config: { providerId: string }[] } }
    | undefined;
  return [
    ...ctx.socialProviders.map((p) => p.id),
    ...(generic?.options.config.map((c) => c.providerId) ?? []),
  ];
}

async function cachedProviderKeys(route: RouteInstance) {
  return (await route.providers.providerCache.get()).map((p) => p.key);
}

async function credentialsEnabled(route: RouteInstance) {
  const ctx = await (await route.auth.getAuth()).$context;
  return ctx.options.emailAndPassword?.enabled;
}

async function cleanup() {
  await db.auditLog.deleteMany({ where: { userId: actorId } });
  await db.authProvider.deleteMany({ where: { key: providerKey } });
}

let restoreCredentials: () => Promise<void>;

beforeAll(async () => {
  // A crashed run leaves its own write behind; snapshotting it would restore the test value.
  await db.appSetting.deleteMany({ where: { key: "credentials_enabled", updatedById: actorId } });
  await cleanup();
  await db.user.deleteMany({ where: { id: actorId } });
  await db.user.create({ data: { id: actorId, email: `${tag}-actor@bilan.local` } });
  restoreCredentials = await snapshotSetting("credentials_enabled");
});

afterAll(async () => {
  await restoreCredentials();
  await cleanup();
  await db.user.deleteMany({ where: { id: actorId } });
  await db.$disconnect();
});

describe("auth state shared across module instances (#208)", () => {
  it("applies a provider change made through one route to another route at once", async () => {
    const login = await loadRouteInstance();
    expect(await cachedProviderKeys(login)).not.toContain(providerKey);
    expect(await handlerProviderIds(login)).not.toContain(providerKey);

    const adminAction = await loadRouteInstance();
    expect(adminAction.providers.providerCache).not.toBe(login.providers.providerCache);

    await adminAction.admin.createAuthProvider(provider(true), { id: actorId });
    expect(await cachedProviderKeys(login)).toContain(providerKey);
    expect(await handlerProviderIds(login)).toContain(providerKey);

    await adminAction.admin.updateAuthProvider(provider(false), { id: actorId });
    expect(await cachedProviderKeys(login)).not.toContain(providerKey);
    expect(await handlerProviderIds(login)).not.toContain(providerKey);
  });

  it("applies an app-setting change made through one route to another route at once", async () => {
    const login = await loadRouteInstance();
    const adminAction = await loadRouteInstance();
    expect(adminAction.settings.appSettings).not.toBe(login.settings.appSettings);

    await adminAction.settings.appSettings.set("credentials_enabled", true, actorId);
    expect(await login.settings.appSettings.get("credentials_enabled")).toBe(true);
    expect(await credentialsEnabled(login)).toBe(true);

    await adminAction.settings.appSettings.set("credentials_enabled", false, actorId);
    expect(await login.settings.appSettings.get("credentials_enabled")).toBe(false);
    expect(await credentialsEnabled(login)).toBe(false);
  });

  it("counts rate-limited attempts across routes", async () => {
    const login = await loadRouteInstance();
    const otherRoute = await loadRouteInstance();
    expect(otherRoute.rateLimit.loginLimiter).not.toBe(login.rateLimit.loginLimiter);
    const email = `${tag}-${Date.now()}@bilan.local`;
    for (let i = 0; i < 5; i++)
      expect(login.rateLimit.loginLimiter.consume(email).allowed).toBe(true);
    expect(otherRoute.rateLimit.loginLimiter.consume(email).allowed).toBe(false);
    otherRoute.rateLimit.loginLimiter.reset(email);
  });
});
