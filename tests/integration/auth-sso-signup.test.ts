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
import {
  createAuthProvider,
  updateAuthProvider,
  type ProviderInput,
} from "@/server/services/settings/auth-providers";

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
function stubIdp(profile: { sub: string; email: string; name: string }) {
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
      });
    }
    if (url === `${issuer}/token`) {
      return json({ access_token: "at", token_type: "Bearer", expires_in: 3600 });
    }
    if (url === `${issuer}/userinfo`) return json({ ...profile, email_verified: true });
    return realFetch(input, init);
  });
}

// Runs the browser side of the flow: start sign-in, then follow the IdP back to the callback.
async function ssoLogin(providerId: string, extra: Record<string, unknown> = {}) {
  const auth = await getAuth();
  const start = await auth.handler(
    new Request(`${appUrl}/api/auth/sign-in/oauth2`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: appUrl },
      body: JSON.stringify({ providerId, callbackURL: "/fr/dashboard", ...extra }),
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
    new Request(`${appUrl}/api/auth/oauth2/callback/${providerId}?code=c0de&state=${state}`, {
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
  await db.user.deleteMany({ where: { email: { contains: tag } } });
  await db.auditLog.deleteMany({ where: { userId: actorId } });
  await db.authProvider.deleteMany({ where: { key: { in: [closedKey, openKey] } } });
}

beforeAll(async () => {
  await cleanup();
  await db.user.deleteMany({ where: { id: actorId } });
  await db.user.create({ data: { id: actorId, email: `${tag}-actor@bilan.local` } });
  await createAuthProvider(provider(closedKey, false), { id: actorId });
  await createAuthProvider(provider(openKey, true), { id: actorId });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
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

  it("refuses POST /sign-in/social with an ID token, even one Google would accept", async () => {
    const spy = vi.spyOn(providerCache, "get").mockResolvedValue([google(false)]);
    invalidateAuthCache();
    try {
      const auth = await getAuth();
      const ctx = await auth.$context;
      const options = ctx.socialProviders.find((p) => p.id === "google")!.options as Record<
        string,
        unknown
      >;
      const email = emailFor("idtoken");
      options.verifyIdToken = async () => true;
      options.getUserInfo = async () => ({
        user: { id: "google-sub", email, name: "Id Token", emailVerified: true },
        data: {},
      });
      const signIn = () =>
        auth.handler(
          new Request(`${appUrl}/api/auth/sign-in/social`, {
            method: "POST",
            headers: { "content-type": "application/json", origin: appUrl },
            body: JSON.stringify({ provider: "google", idToken: { token: "h.p.s" } }),
          }),
        );
      const refused = await signIn();
      expect(refused.status).toBe(401);
      expect(refused.headers.get("set-cookie")).toBeNull();
      expect(await db.user.findUnique({ where: { email } })).toBeNull();

      // Control: without the flag, this path creates the user despite disableSignUp.
      options.disableIdTokenSignIn = false;
      expect((await signIn()).status).toBe(200);
      expect(await db.user.findUnique({ where: { email } })).not.toBeNull();
    } finally {
      spy.mockRestore();
      invalidateAuthCache();
    }
  });

  it.each([
    [false, true],
    [true, false],
  ])("allowSignUp=%s sets disableSignUp=%s on the social provider", async (allow, disabled) => {
    const spy = vi.spyOn(providerCache, "get").mockResolvedValue([google(allow)]);
    try {
      const options = await buildOptions();
      expect(options.socialProviders?.google).toMatchObject({
        disableSignUp: disabled,
        disableIdTokenSignIn: true,
      });
      expect(options.socialProviders?.google).not.toHaveProperty("disableImplicitSignUp");
    } finally {
      spy.mockRestore();
    }
  });
});
