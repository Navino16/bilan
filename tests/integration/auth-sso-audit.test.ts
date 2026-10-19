import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));
const notify = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/server/services/mail/security-notifications", () => ({
  notifySecurityEvent: notify,
}));

import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { env } from "@/env";
import { getAuth, invalidateAuthCache } from "@/server/auth";
import { encrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { appSettings } from "@/server/services/settings/app-settings";
import { createAuthProvider, type ProviderInput } from "@/server/services/settings/auth-providers";
import { snapshotSetting } from "./support/app-setting-snapshot";

// Each case runs a full OAuth round trip against a stubbed IdP.
vi.setConfig({ testTimeout: 20_000 });

const tag = "sso-audit";
const actorId = `${tag}-actor`;
const closedKey = `${tag}-closed`;
const openKey = `${tag}-open`;
const issuer = "https://idp.sso-audit.test";
const appUrl = env.APP_URL.replace(/\/$/, "");
const realFetch = globalThis.fetch;

const provider = (key: string, allowSignUp: boolean): ProviderInput => ({
  key,
  type: "oidc",
  displayName: `Display ${key}`,
  enabled: true,
  issuer,
  clientId: "client",
  clientSecret: "secret",
  allowSignUp,
});

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

async function ssoLogin(providerId: string) {
  const auth = await getAuth();
  const start = await auth.handler(
    new Request(`${appUrl}/api/auth/sign-in/oauth2`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: appUrl },
      body: JSON.stringify({ providerId, callbackURL: "/fr/dashboard" }),
    }),
  );
  const { url } = (await start.json()) as { url: string };
  const state = new URL(url).searchParams.get("state")!;
  const cookie = start.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const res = await auth.handler(
    new Request(`${appUrl}/api/auth/oauth2/callback/${providerId}?code=c0de&state=${state}`, {
      headers: { cookie: `${cookie}; NEXT_LOCALE=en` },
    }),
  );
  return res.headers.get("location") ?? "";
}

let seq = 0;
const emailFor = (label: string) => `${tag}-${label}-${Date.now()}-${seq++}@bilan.local`;

async function linkedUser(label: string, providerId: string, sub: string) {
  const id = `${tag}-${label}-${Date.now()}-${seq++}`;
  return db.user.create({
    data: {
      id,
      email: emailFor(label),
      name: label,
      emailVerified: true,
      authAccounts: { create: { id: `${id}-acc`, accountId: sub, providerId } },
    },
  });
}

const auditsOf = (userId: string) =>
  db.auditLog.findMany({ where: { userId, action: { startsWith: "auth." } } });

// Failed SSO sign-ins carry no user: find them by provider among this run's rows.
let since: Date;
const failureIds: string[] = [];
async function ssoFailures(providerId: string | null) {
  const rows = await db.auditLog.findMany({
    where: {
      action: "auth.login.failed",
      userId: null,
      createdAt: { gte: since },
      id: { notIn: failureIds },
    },
  });
  failureIds.push(...rows.map((r) => r.id));
  return rows.filter((r) => (r.metadata as { providerId?: string }).providerId === providerId);
}

async function cleanup() {
  const where = { user: { email: { contains: tag } } };
  await db.session.deleteMany({ where });
  await db.authAccount.deleteMany({ where });
  const users = await db.user.findMany({
    where: { email: { contains: tag } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await db.auditLog.deleteMany({ where: { userId: { in: [actorId, ...ids] } } });
  await db.category.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { email: { contains: tag } } });
  await db.authProvider.deleteMany({ where: { key: { in: [closedKey, openKey] } } });
}

let restoreMode: () => Promise<void>;

beforeAll(async () => {
  await cleanup();
  await db.user.deleteMany({ where: { id: actorId } });
  await db.user.create({ data: { id: actorId, email: `${tag}-actor@bilan.local` } });
  restoreMode = await snapshotSetting("registration_mode");
  await appSettings.set("registration_mode", "OPEN", actorId);
  await createAuthProvider(provider(closedKey, false), { id: actorId });
  await createAuthProvider(provider(openKey, true), { id: actorId });
});

beforeEach(() => {
  since = new Date(Date.now() - 1000);
  notify.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { id: { in: failureIds } } });
  await restoreMode();
  await cleanup();
  await db.user.deleteMany({ where: { id: actorId } });
  invalidateAuthCache();
  await db.$disconnect();
});

describe("SSO sign-in audit and alert (#258)", () => {
  it("audits a linked user's sign-in and sends the new sign-in alert", async () => {
    const user = await linkedUser("signin", closedKey, "sub-signin");
    stubIdp({ sub: "sub-signin", email: user.email, name: "Signin" });
    expect(await ssoLogin(closedKey)).toBe("/fr/dashboard");

    const audits = await auditsOf(user.id);
    expect(audits.map((a) => [a.action, a.metadata])).toEqual([
      ["auth.login.success", { method: "sso", providerId: closedKey, email: user.email }],
    ]);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      "new_login",
      expect.objectContaining({
        userId: user.id,
        pageLocale: "en",
        method: { kind: "sso", provider: `Display ${closedKey}` },
      }),
    );
  });

  it("audits a first SSO sign-in that creates the account as a single sign-up", async () => {
    const email = emailFor("signup");
    stubIdp({ sub: "sub-signup", email, name: "Signup" });
    expect(await ssoLogin(openKey)).toBe("/fr/dashboard");
    const user = await db.user.findUniqueOrThrow({ where: { email } });

    const audits = await auditsOf(user.id);
    expect(audits.filter((a) => a.action.startsWith("auth.login"))).toEqual([]);
    const signups = audits.filter((a) => a.action === "auth.register.success");
    expect(signups.map((a) => a.metadata)).toEqual([{ method: "sso", providerId: openKey, email }]);
    expect(notify).not.toHaveBeenCalled();

    // The next sign-in through the same identity is a plain sign-in.
    expect(await ssoLogin(openKey)).toBe("/fr/dashboard");
    expect(
      await db.auditLog.count({ where: { userId: user.id, action: "auth.login.success" } }),
    ).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  // Each setup returns the address the IdP asserts.
  const refusals: [string, string, (sub: string) => Promise<string>][] = [
    [
      "an unlinked local account",
      "account_not_linked",
      async () => {
        const email = emailFor("local");
        await db.user.create({ data: { id: `${tag}-local-${seq++}`, email, name: "Local" } });
        return email;
      },
    ],
    ["a closed sign-up", "signup_disabled", async () => emailFor("closed")],
    [
      "a disabled account",
      "banned",
      async (sub) => {
        const user = await linkedUser("banned", closedKey, sub);
        await db.user.update({ where: { id: user.id }, data: { banned: true } });
        return user.email;
      },
    ],
  ];

  it.each(refusals)("audits a sign-in refused for %s", async (_label, reason, setup) => {
    const sub = `sub-${reason}`;
    stubIdp({ sub, email: await setup(sub), name: "Refused" });

    expect(await ssoLogin(closedKey)).toMatch(`${appUrl}/login?error=${reason}`);
    const failures = await ssoFailures(closedKey);
    expect(failures.map((f) => f.metadata)).toEqual([
      { method: "sso", providerId: closedKey, reason },
    ]);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("forged SSO callbacks (#258)", () => {
  it("keeps a forged error and an unknown provider id out of the audit log", async () => {
    // Only one Google row may exist: set any aside and put it back afterwards.
    const prior = await db.authProvider.findMany({ where: { type: "google" } });
    await db.authProvider.deleteMany({ where: { id: { in: prior.map((r) => r.id) } } });
    await db.authProvider.create({
      data: {
        key: "google",
        type: "google",
        displayName: "Google",
        enabled: true,
        clientId: "gid",
        clientSecretEnc: encrypt("gsecret", dataKey),
      },
    });
    invalidateAuthCache();
    try {
      const auth = await getAuth();
      const googleCallback = async (error: string) => {
        const start = await auth.handler(
          new Request(`${appUrl}/api/auth/sign-in/social`, {
            method: "POST",
            headers: { "content-type": "application/json", origin: appUrl },
            body: JSON.stringify({ provider: "google", callbackURL: "/fr/dashboard" }),
          }),
        );
        const { url } = (await start.json()) as { url: string };
        const state = new URL(url).searchParams.get("state")!;
        const cookie = start.headers
          .getSetCookie()
          .map((c) => c.split(";")[0])
          .join("; ");
        const query = new URLSearchParams({ error, state });
        return auth.handler(
          new Request(`${appUrl}/api/auth/callback/google?${query}`, { headers: { cookie } }),
        );
      };

      const forged = "Your account is locked, call +33 6 12 34 56 78";
      expect((await googleCallback(forged)).status).toBe(302);
      expect((await ssoFailures("google")).map((f) => f.metadata)).toEqual([
        { method: "sso", providerId: "google", reason: "other" },
      ]);

      // A sign-in cancelled at the IdP is not a failed sign-in.
      await googleCallback("access_denied");
      expect(await ssoFailures("google")).toEqual([]);

      const unknown = "x".repeat(300);
      for (const path of [`callback/${unknown}`, `oauth2/callback/${unknown}`]) {
        await auth.handler(new Request(`${appUrl}/api/auth/${path}?error=${unknown}&state=s`));
      }
      expect(await ssoFailures(null)).toEqual([]);
      expect(await ssoFailures(unknown)).toEqual([]);
    } finally {
      await db.authProvider.deleteMany({ where: { type: "google" } });
      for (const r of prior) {
        await db.authProvider.create({ data: { ...r, config: r.config ?? Prisma.DbNull } });
      }
      invalidateAuthCache();
    }
  });
});
