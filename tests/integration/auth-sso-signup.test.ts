import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import type { AuthProvider } from "@prisma/client";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

import { db } from "@/server/db";
import { env } from "@/env";
import { buildOptions, getAuth, invalidateAuthCache } from "@/server/auth";
import { providerCache } from "@/server/auth/providers";
import { encrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { appSettings } from "@/server/services/settings/app-settings";
import {
  createAuthProvider,
  updateAuthProvider,
  type ProviderInput,
} from "@/server/services/settings/auth-providers";
import { snapshotSetting } from "./support/app-setting-snapshot";

// Each case signs users up and in (scrypt) and runs a full OAuth round trip.
vi.setConfig({ testTimeout: 20_000 });

const tag = "sso-signup";
const actorId = `${tag}-actor`;
const closedKey = `${tag}-closed`;
const openKey = `${tag}-open`;
const issuer = "https://idp.sso-signup.test";
const appUrl = env.APP_URL.replace(/\/$/, "");
const realFetch = globalThis.fetch;

const provider = (key: string, allowSignUp: boolean): ProviderInput => ({
  key,
  type: "oidc",
  displayName: key,
  enabled: true,
  issuer,
  clientId: "client",
  clientSecret: "secret",
  allowSignUp,
});

// Minimal IdP: discovery, token exchange and userinfo for one profile.
function stubIdp(
  profile: { sub: string; email: string; name: string },
  claims: Record<string, unknown> = { email_verified: true },
  discovery: Record<string, unknown> = {},
) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    if (url === `${issuer}/.well-known/openid-configuration`) {
      return json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`,
        ...discovery,
      });
    }
    if (url === `${issuer}/token`) {
      return json({ access_token: "at", token_type: "Bearer", expires_in: 3600 });
    }
    if (url === `${issuer}/userinfo`) return json({ ...profile, ...claims });
    return realFetch(input, init);
  });
}

// Runs the browser side of the flow: start sign-in, then follow the IdP back to the callback.
async function ssoLogin(providerId: string, extra: Record<string, unknown> = {}) {
  const auth = await getAuth();
  const start = await auth.handler(
    new Request(`${appUrl}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: appUrl },
      body: JSON.stringify({ provider: providerId, callbackURL: "/fr/dashboard", ...extra }),
    }),
  );
  expect(start.status).toBe(200);
  const { url } = (await start.json()) as { url: string };
  const state = new URL(url).searchParams.get("state")!;
  const cookie = start.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const res = await auth.handler(
    new Request(`${appUrl}/api/auth/callback/${providerId}?code=c0de&state=${state}`, {
      headers: { cookie },
    }),
  );
  return { status: res.status, location: res.headers.get("location") ?? "" };
}

const emailFor = (label: string) => `${tag}-${label}+${Date.now()}@bilan.local`;

async function cleanup() {
  const where = { user: { email: { contains: tag } } };
  await db.session.deleteMany({ where });
  await db.authAccount.deleteMany({ where });
  const users = await db.user.findMany({
    where: { email: { contains: tag } },
    select: { id: true },
  });
  await db.auditLog.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await db.user.deleteMany({ where: { email: { contains: tag } } });
  await db.auditLog.deleteMany({ where: { userId: actorId } });
  await db.authProvider.deleteMany({ where: { key: { in: [closedKey, openKey] } } });
}

let restoreMode: () => Promise<void>;
const setMode = (mode: string) => appSettings.set("registration_mode", mode, actorId);

beforeAll(async () => {
  await cleanup();
  await db.user.deleteMany({ where: { id: actorId } });
  await db.user.create({ data: { id: actorId, email: `${tag}-actor@bilan.local` } });
  restoreMode = await snapshotSetting("registration_mode");
  await setMode("OPEN");
  await createAuthProvider(provider(closedKey, false), { id: actorId });
  await createAuthProvider(provider(openKey, true), { id: actorId });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await restoreMode();
  await cleanup();
  await db.user.deleteMany({ where: { id: actorId } });
  invalidateAuthCache();
  await db.$disconnect();
});

describe("per-provider SSO sign-up (#200)", () => {
  it("refuses an unknown IdP user when the provider does not allow sign-up", async () => {
    const email = emailFor("refused");
    stubIdp({ sub: "sub-refused", email, name: "Refused" });
    const res = await ssoLogin(closedKey);
    expect(res.status).toBe(302);
    expect(res.location).toBe(`${appUrl}/login?error=signup_disabled`);
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
  });

  it("ignores requestSignUp: true from the client", async () => {
    const email = emailFor("forced");
    stubIdp({ sub: "sub-forced", email, name: "Forced" });
    const res = await ssoLogin(closedKey, { requestSignUp: true });
    expect(res.location).toBe(`${appUrl}/login?error=signup_disabled`);
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
  });

  it("creates the user when the provider allows sign-up", async () => {
    const email = emailFor("created");
    stubIdp({ sub: "sub-created", email, name: "Created" });
    const res = await ssoLogin(openKey);
    expect(res.status).toBe(302);
    expect(res.location).toBe("/fr/dashboard");
    const user = await db.user.findUnique({
      where: { email },
      include: { authAccounts: true, sessions: true },
    });
    expect(user?.authAccounts.map((a) => [a.providerId, a.accountId])).toEqual([
      [openKey, "sub-created"],
    ]);
    expect(user?.sessions).toHaveLength(1);
  });

  it("still signs in an already linked user when sign-up is off", async () => {
    const email = emailFor("linked");
    const id = `${tag}-linked-${Date.now()}`;
    const user = await db.user.create({
      data: {
        id,
        email,
        name: "Linked",
        emailVerified: true,
        authAccounts: {
          create: { id: `${id}-acc`, accountId: "sub-linked", providerId: closedKey },
        },
      },
    });
    stubIdp({ sub: "sub-linked", email, name: "Linked" });
    const res = await ssoLogin(closedKey);
    expect(res.location).toBe("/fr/dashboard");
    expect(await db.session.count({ where: { userId: user.id } })).toBe(1);
  });

  it.each([closedKey, openKey])(
    "does not link an existing local user by email through %s",
    async (key) => {
      const email = emailFor(`local-${key}`);
      const id = `${tag}-local-${key}-${Date.now()}`;
      await db.user.create({ data: { id, email, name: "Local", emailVerified: true } });
      stubIdp({ sub: `sub-local-${key}`, email, name: "Local" });
      const res = await ssoLogin(key);
      expect(res.location).toBe(`${appUrl}/login?error=account_not_linked`);
      expect(await db.authAccount.count({ where: { userId: id } })).toBe(0);
      expect(await db.session.count({ where: { userId: id } })).toBe(0);
    },
  );

  it("applies a flag change on the next handler build", async () => {
    await updateAuthProvider(provider(openKey, false), { id: actorId });
    const email = emailFor("toggled");
    stubIdp({ sub: "sub-toggled", email, name: "Toggled" });
    expect((await ssoLogin(openKey)).location).toBe(`${appUrl}/login?error=signup_disabled`);
    const audit = await db.auditLog.findFirst({
      where: { userId: actorId, action: "settings.auth_provider.update" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.metadata).toMatchObject({ key: openKey, allowSignUp: false });
    await updateAuthProvider(provider(openKey, true), { id: actorId });
  });
});

describe("registration mode gates SSO sign-up (#204)", () => {
  afterEach(async () => {
    await setMode("OPEN");
  });

  it.each(["INVITE_ONLY", "DISABLED"])(
    "refuses an unknown IdP user in %s mode even when the provider allows sign-up",
    async (mode) => {
      await setMode(mode);
      const email = emailFor(`mode-${mode}`);
      stubIdp({ sub: `sub-mode-${mode}`, email, name: "Mode" });
      expect((await ssoLogin(openKey)).location).toBe(`${appUrl}/login?error=signup_disabled`);
      expect(await db.user.findUnique({ where: { email } })).toBeNull();
    },
  );

  it("creates the user in OPEN mode", async () => {
    const email = emailFor("mode-open");
    stubIdp({ sub: "sub-mode-open", email, name: "Open" });
    expect((await ssoLogin(openKey)).location).toBe("/fr/dashboard");
    expect(await db.user.findUnique({ where: { email } })).not.toBeNull();
  });

  it.each(["OPEN", "INVITE_ONLY", "DISABLED"])(
    "still signs in an already linked user in %s mode",
    async (mode) => {
      await setMode(mode);
      const email = emailFor(`linked-${mode}`);
      const id = `${tag}-linked-${mode}-${Date.now()}`;
      await db.user.create({
        data: {
          id,
          email,
          name: "Linked",
          emailVerified: true,
          authAccounts: {
            create: { id: `${id}-acc`, accountId: `sub-linked-${mode}`, providerId: openKey },
          },
        },
      });
      stubIdp({ sub: `sub-linked-${mode}`, email, name: "Linked" });
      expect((await ssoLogin(openKey)).location).toBe("/fr/dashboard");
      expect(await db.session.count({ where: { userId: id } })).toBe(1);
    },
  );
});

describe("IdP-asserted e-mail verification (#240)", () => {
  const ssoVerifiedAudits = async (userId: string) =>
    (await db.auditLog.findMany({ where: { userId, action: "auth.email.verified" } })).filter(
      (a) => (a.metadata as { via?: string } | null)?.via === "sso",
    ).length;

  it.each([
    [true, true],
    [false, false],
    ["true", false],
    [undefined, false],
  ])("signs a user up with email_verified %j as verified: %s", async (claim, expected) => {
    const email = emailFor(`claim-${JSON.stringify(claim)}`);
    stubIdp(
      { sub: `sub-claim-${JSON.stringify(claim)}`, email, name: "Claim" },
      { email_verified: claim },
    );
    expect((await ssoLogin(openKey)).location).toBe("/fr/dashboard");
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerified).toBe(expected);
    expect(await ssoVerifiedAudits(user.id)).toBe(expected ? 1 : 0);
  });

  it.each([
    [true, true],
    ["false", false],
  ])("marks a linked user verified on sign-in only for %j", async (claim, expected) => {
    const email = emailFor(`linked-claim-${JSON.stringify(claim)}`);
    const id = `${tag}-linked-claim-${JSON.stringify(claim)}-${Date.now()}`;
    await db.user.create({
      data: {
        id,
        email,
        name: "Linked claim",
        authAccounts: {
          create: {
            id: `${id}-acc`,
            accountId: `sub-lc-${JSON.stringify(claim)}`,
            providerId: openKey,
          },
        },
      },
    });
    stubIdp(
      { sub: `sub-lc-${JSON.stringify(claim)}`, email, name: "Linked claim" },
      {
        email_verified: claim,
      },
    );
    expect((await ssoLogin(openKey)).location).toBe("/fr/dashboard");
    expect((await db.user.findUniqueOrThrow({ where: { id } })).emailVerified).toBe(expected);
    expect(await ssoVerifiedAudits(id)).toBe(expected ? 1 : 0);
    // Already verified: the next sign-in isn't audited again.
    expect((await ssoLogin(openKey)).location).toBe("/fr/dashboard");
    expect(await ssoVerifiedAudits(id)).toBe(expected ? 1 : 0);
  });
});

describe("Google sign-up flag (#200)", () => {
  const google = (allowSignUp: boolean) =>
    ({
      id: `${tag}-google`,
      type: "google",
      key: "google",
      displayName: "Google",
      enabled: true,
      issuer: null,
      clientId: "gid",
      clientSecretEnc: encrypt("gsecret", dataKey),
      scopes: null,
      config: null,
      allowSignUp,
      updatedAt: new Date(0),
      updatedById: null,
    }) satisfies AuthProvider;

  it("refuses POST /sign-in/social with an ID token, for Google and OIDC providers alike", async () => {
    const rows = await providerCache.get();
    const spy = vi.spyOn(providerCache, "get").mockResolvedValue([...rows, google(true)]);
    const email = emailFor("idtoken");
    // A JWKS makes Better Auth accept ID tokens for the OIDC provider: only the guard refuses them.
    stubIdp({ sub: "sub-idtoken", email, name: "Id Token" }, undefined, {
      jwks_uri: `${issuer}/jwks`,
      id_token_signing_alg_values_supported: ["RS256"],
    });
    invalidateAuthCache();
    try {
      const auth = await getAuth();
      for (const provider of ["google", openKey]) {
        const res = await auth.handler(
          new Request(`${appUrl}/api/auth/sign-in/social`, {
            method: "POST",
            headers: { "content-type": "application/json", origin: appUrl },
            body: JSON.stringify({ provider, idToken: { token: "h.p.s" } }),
          }),
        );
        expect(res.status).toBe(404);
        expect(await res.json()).toMatchObject({ code: "ID_TOKEN_NOT_SUPPORTED" });
        expect(res.headers.get("set-cookie")).toBeNull();
      }
      expect(await db.user.findUnique({ where: { email } })).toBeNull();
    } finally {
      spy.mockRestore();
      invalidateAuthCache();
    }
  });

  it.each([
    [false, "OPEN", true],
    [true, "OPEN", false],
    [true, "INVITE_ONLY", true],
    [true, "DISABLED", true],
  ])("allowSignUp=%s in %s mode sets disableSignUp=%s", async (allow, mode, disabled) => {
    const spy = vi.spyOn(providerCache, "get").mockResolvedValue([google(allow)]);
    try {
      await setMode(mode);
      const options = await buildOptions();
      expect(options.socialProviders?.google).toMatchObject({
        disableSignUp: disabled,
        disableIdTokenSignIn: true,
      });
      expect(options.socialProviders?.google).not.toHaveProperty("disableImplicitSignUp");
    } finally {
      spy.mockRestore();
      await setMode("OPEN");
    }
  });
});

describe("OIDC discovery at handler build", () => {
  const genericKeys = async () => {
    const plugin = (await buildOptions()).plugins?.find((p) => p.id === "generic-oauth") as
      | { options: { config: { providerId: string }[] } }
      | undefined;
    return plugin?.options.config.map((c) => c.providerId) ?? [];
  };
  const discoveryFetch = (onDiscovery: (signal?: AbortSignal | null) => Promise<Response>) =>
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) =>
      new URL(input instanceof Request ? input.url : input).origin === issuer
        ? onDiscovery(init?.signal)
        : realFetch(input, init),
    );

  it("leaves out a provider whose discovery hangs", async () => {
    discoveryFetch(
      (signal) =>
        new Promise((_, reject) => signal?.addEventListener("abort", () => reject(signal.reason))),
    );
    expect(await genericKeys()).not.toContain(openKey);
  });

  it("keeps a provider whose discovery fails fast, for Better Auth to retry", async () => {
    discoveryFetch(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await genericKeys()).toContain(openKey);
  });
});
