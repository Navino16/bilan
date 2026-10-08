import { createHmac } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

// The Server Actions read the request through next/headers.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => request.headers,
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { env } from "@/env";
import { getAuth, invalidateAuthCache } from "@/server/auth";
import { encrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { appSettings } from "@/server/services/settings/app-settings";
import {
  createAuthProvider,
  deleteAuthProvider,
  type ProviderInput,
} from "@/server/services/settings/auth-providers";
import {
  listIdentities,
  listSsoProviders,
  unlinkIdentity,
} from "@/server/services/users/identities";
import { linkIdentityAction, unlinkIdentityAction } from "@/server/transport/actions/identities";
import { snapshotSetting } from "./support/app-setting-snapshot";

// Each case signs users up and in (scrypt) and runs a full OAuth round trip.
vi.setConfig({ testTimeout: 20_000 });

const tag = "sso-link";
const actorId = `${tag}-actor`;
const idpKey = `${tag}-idp`;
const otherKey = `${tag}-other`;
const offKey = `${tag}-off`;
const halfKey = `${tag}-half`;
const tmpKey = `${tag}-tmp`;
const issuer = "https://idp.sso-link.test";
const appUrl = env.APP_URL.replace(/\/$/, "");
const realFetch = globalThis.fetch;
const password = "correct-horse-battery-staple";

const provider = (key: string, over: Partial<ProviderInput> = {}): ProviderInput => ({
  key,
  type: "oidc",
  displayName: `Display ${key}`,
  enabled: true,
  issuer,
  clientId: "client",
  clientSecret: "super-secret-value",
  allowSignUp: false,
  ...over,
});

function stubIdp(profile: { sub: string; email: string }) {
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
    if (url === `${issuer}/userinfo`) {
      return json({ ...profile, name: "Linked", email_verified: true });
    }
    return realFetch(input, init);
  });
}

const cookiesOf = (res: { headers: Headers }) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

let seq = 0;
const emailFor = (label: string) => `${tag}-${label}-${Date.now()}-${seq++}@bilan.local`;

// A password user signed in through Better Auth; its session cookie becomes the request's.
async function signedInUser(label: string) {
  const auth = await getAuth();
  const email = emailFor(label);
  const { headers, response } = await auth.api.signUpEmail({
    body: { email, password, name: label },
    returnHeaders: true,
  });
  return { id: response.user.id, email, cookie: cookiesOf({ headers }) };
}

function actAs(user: { cookie: string }) {
  request.headers = new Headers({ cookie: user.cookie });
}

// In the app nextCookies() hands the signed state cookie to the browser; Better Auth runs outside
// Vitest's module graph here, so the test signs it the same way (better-call signCookieValue).
async function stateCookie(state: string) {
  const ctx = await (await getAuth()).$context;
  const signature = createHmac("sha256", ctx.secret).update(state).digest("base64");
  return `${ctx.createAuthCookie("state").name}=${encodeURIComponent(`${state}.${signature}`)}`;
}

// The browser side: follow the authorization URL to the IdP and back to the callback.
async function completeLink(url: string, key: string) {
  const state = new URL(url).searchParams.get("state")!;
  const cookie = await stateCookie(state);
  const auth = await getAuth();
  const res = await auth.handler(
    new Request(`${appUrl}/api/auth/oauth2/callback/${key}?code=c0de&state=${state}`, {
      headers: { cookie },
    }),
  );
  return { status: res.status, location: res.headers.get("location") ?? "" };
}

async function startLink(key: string) {
  const res = await linkIdentityAction(key, "fr");
  if (!res.ok) throw new Error(`link start failed: ${res.error}`);
  return res.url;
}

async function addIdentity(userId: string, providerId: string, accountId = `sub-${seq++}`) {
  return db.authAccount.create({
    data: { id: `${tag}-acc-${Date.now()}-${seq++}`, userId, providerId, accountId },
  });
}

async function cleanup() {
  const where = { user: { email: { contains: tag } } };
  await db.session.deleteMany({ where });
  await db.authAccount.deleteMany({ where });
  await db.passkey.deleteMany({ where });
  const users = await db.user.findMany({
    where: { email: { contains: tag } },
    select: { id: true },
  });
  await db.auditLog.deleteMany({ where: { userId: { in: [actorId, ...users.map((u) => u.id)] } } });
  await db.category.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await db.user.deleteMany({ where: { email: { contains: tag } } });
  await db.authProvider.deleteMany({
    where: { key: { in: [idpKey, otherKey, offKey, halfKey, tmpKey] } },
  });
}

let restoreCredentials: () => Promise<void>;

beforeAll(async () => {
  await cleanup();
  restoreCredentials = await snapshotSetting("credentials_enabled");
  await db.user.deleteMany({ where: { id: actorId } });
  await db.user.create({ data: { id: actorId, email: `${tag}-actor@bilan.local` } });
  await appSettings.set("credentials_enabled", true, actorId);
  await createAuthProvider(provider(idpKey), { id: actorId });
  await createAuthProvider(provider(otherKey, { allowSignUp: true }), { id: actorId });
  await createAuthProvider(provider(offKey, { enabled: false }), { id: actorId });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await cleanup();
  await restoreCredentials();
  await db.auditLog.deleteMany({ where: { userId: actorId } });
  await db.user.deleteMany({ where: { id: actorId } });
  invalidateAuthCache();
  await db.$disconnect();
});

describe("SSO buttons (#204)", () => {
  it("lists only enabled, configured providers, without client credentials", async () => {
    const half = await db.authProvider.create({
      data: { key: halfKey, type: "oidc", displayName: "Half", enabled: true, issuer },
    });
    invalidateAuthCache();
    try {
      const all = (await listSsoProviders()).filter((p) => p.providerId.startsWith(tag));
      expect(all).toEqual([
        { providerId: idpKey, kind: "oidc", displayName: `Display ${idpKey}` },
        { providerId: otherKey, kind: "oidc", displayName: `Display ${otherKey}` },
      ]);
      expect(JSON.stringify(all)).not.toMatch(/client|secret/i);
      const signUp = (await listSsoProviders({ signUpOnly: true })).filter((p) =>
        p.providerId.startsWith(tag),
      );
      expect(signUp.map((p) => p.providerId)).toEqual([otherKey]);
    } finally {
      await db.authProvider.delete({ where: { id: half.id } });
      invalidateAuthCache();
    }
  });

  it("keeps the sign-in endpoints reachable and the link endpoints blocked over HTTP", async () => {
    const user = await signedInUser("http");
    const auth = await getAuth();
    const post = (path: string, body: unknown) =>
      auth.handler(
        new Request(`${appUrl}/api/auth${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: appUrl, cookie: user.cookie },
          body: JSON.stringify(body),
        }),
      );
    stubIdp({ sub: "unused", email: user.email });
    const signIn = await post("/sign-in/oauth2", { providerId: idpKey, callbackURL: "/fr" });
    expect(signIn.status).toBe(200);
    expect(((await signIn.json()) as { url: string }).url).toMatch(`${issuer}/authorize`);
    expect((await post("/oauth2/link", { providerId: idpKey, callbackURL: "/fr" })).status).toBe(
      404,
    );
    expect((await post("/link-social", { provider: "google", callbackURL: "/fr" })).status).toBe(
      404,
    );
    expect((await post("/unlink-account", { providerId: idpKey })).status).toBe(404);
    for (const path of ["/get-access-token", "/refresh-token"]) {
      expect((await post(path, { providerId: idpKey })).status).toBe(404);
    }
    const info = await auth.handler(
      new Request(`${appUrl}/api/auth/account-info`, { headers: { cookie: user.cookie } }),
    );
    expect(info.status).toBe(404);
    // OIDC configs also sit in the social provider list, without their sign-up gate (#204).
    expect((await post("/sign-in/social", { provider: idpKey, callbackURL: "/fr" })).status).toBe(
      404,
    );
  });
});

describe("linking an identity from Settings (#204)", () => {
  it("links the IdP identity to the signed-in user and audits it", async () => {
    const user = await signedInUser("link");
    actAs(user);
    stubIdp({ sub: "sub-link-ok", email: user.email });
    const url = await startLink(idpKey);
    expect(url).toMatch(`${issuer}/authorize`);
    expect(new URL(url).searchParams.get("redirect_uri")).toBe(
      `${appUrl}/api/auth/oauth2/callback/${idpKey}`,
    );

    const res = await completeLink(url, idpKey);
    expect(res.status).toBe(302);
    expect(res.location).toBe(`/fr/settings/security?linked=${idpKey}`);
    const accounts = await db.authAccount.findMany({ where: { userId: user.id } });
    expect(accounts.map((a) => [a.providerId, a.accountId]).sort()).toEqual([
      ["credential", user.id],
      [idpKey, "sub-link-ok"],
    ]);
    const audit = await db.auditLog.findFirst({
      where: { userId: user.id, action: "auth.identity.linked" },
    });
    expect(audit?.metadata).toEqual({ providerId: idpKey });
    expect(
      await db.auditLog.count({ where: { userId: user.id, action: "auth.identity.link_failed" } }),
    ).toBe(0);

    const view = await listIdentities(user.id);
    expect(view.linked.map((i) => [i.providerId, i.displayName, i.canUnlink])).toEqual([
      [idpKey, `Display ${idpKey}`, true],
    ]);
    expect(view.linkable.map((p) => p.providerId)).not.toContain(idpKey);
    expect(view.linkable.map((p) => p.providerId)).toContain(otherKey);
    expect(view.linkable.map((p) => p.providerId)).not.toContain(offKey);

    // The linked identity now signs this user in.
    const auth = await getAuth();
    const start = await auth.handler(
      new Request(`${appUrl}/api/auth/sign-in/oauth2`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: appUrl },
        body: JSON.stringify({ providerId: idpKey, callbackURL: "/fr/dashboard" }),
      }),
    );
    const state = new URL(((await start.json()) as { url: string }).url).searchParams.get("state");
    const signIn = await auth.handler(
      new Request(`${appUrl}/api/auth/oauth2/callback/${idpKey}?code=c0de&state=${state}`, {
        headers: { cookie: cookiesOf(start) },
      }),
    );
    expect(signIn.headers.get("location")).toBe("/fr/dashboard");
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookiesOf(signIn) }),
    });
    expect(session?.user.id).toBe(user.id);
  });

  it("refuses an identity already linked to another user", async () => {
    const owner = await signedInUser("owner");
    await addIdentity(owner.id, idpKey, "sub-taken");
    const user = await signedInUser("thief");
    actAs(user);
    stubIdp({ sub: "sub-taken", email: user.email });
    const res = await completeLink(await startLink(idpKey), idpKey);
    expect(res.location).toBe(
      "/fr/settings/security?error=account_already_linked_to_different_user",
    );
    expect(await db.authAccount.count({ where: { userId: user.id, providerId: idpKey } })).toBe(0);
    expect(
      await db.authAccount.count({ where: { providerId: idpKey, accountId: "sub-taken" } }),
    ).toBe(1);
    expect(
      await db.auditLog.count({ where: { userId: user.id, action: "auth.identity.linked" } }),
    ).toBe(0);
    const failed = await db.auditLog.findFirst({
      where: { userId: user.id, action: "auth.identity.link_failed" },
    });
    expect(failed?.metadata).toEqual({
      providerId: idpKey,
      error: "account_already_linked_to_different_user",
    });
  });

  it("refuses an identity whose email differs from the account's", async () => {
    const user = await signedInUser("mismatch");
    actAs(user);
    stubIdp({ sub: "sub-mismatch", email: emailFor("someone-else") });
    const res = await completeLink(await startLink(idpKey), idpKey);
    expect(res.location).toBe("/fr/settings/security?error=email_doesn't_match");
    expect(await db.authAccount.count({ where: { userId: user.id, providerId: idpKey } })).toBe(0);
    const failed = await db.auditLog.findFirst({
      where: { userId: user.id, action: "auth.identity.link_failed" },
    });
    expect(failed?.metadata).toEqual({ providerId: idpKey, error: "email_doesn't_match" });
  });

  it("rejects a link callback without the state cookie of the browser that started it", async () => {
    const victim = await signedInUser("csrf-victim");
    const other = await signedInUser("csrf-other");
    actAs(victim);
    stubIdp({ sub: "sub-csrf", email: victim.email });
    const url = await startLink(idpKey);
    const state = new URL(url).searchParams.get("state")!;
    const auth = await getAuth();
    for (const cookie of ["", other.cookie]) {
      const res = await auth.handler(
        new Request(`${appUrl}/api/auth/oauth2/callback/${idpKey}?code=c0de&state=${state}`, {
          headers: { cookie },
        }),
      );
      expect(res.headers.get("location")).toBe(`${appUrl}/login?error=state_mismatch`);
    }
    expect(
      await db.authAccount.count({ where: { providerId: idpKey, accountId: "sub-csrf" } }),
    ).toBe(0);
    expect(
      await db.auditLog.count({
        where: { userId: { in: [victim.id, other.id] }, action: "auth.identity.linked" },
      }),
    ).toBe(0);
  });

  it("refuses a disabled provider, an already linked one and a stale session", async () => {
    const user = await signedInUser("refusals");
    actAs(user);
    expect(await linkIdentityAction(offKey, "fr")).toEqual({ ok: false, error: "UNAVAILABLE" });
    await addIdentity(user.id, idpKey);
    expect(await linkIdentityAction(idpKey, "fr")).toEqual({
      ok: false,
      error: "ALREADY_LINKED",
    });
    expect(await linkIdentityAction(otherKey, "xx")).toEqual({ ok: false, error: "INVALID" });

    await db.session.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000) },
    });
    expect(await linkIdentityAction(otherKey, "fr")).toEqual({ ok: false, error: "NOT_FRESH" });
    const [identity] = (await listIdentities(user.id)).linked;
    expect(await unlinkIdentityAction(identity.id)).toEqual({ ok: false, error: "NOT_FRESH" });
  });
});

describe("unlinking an identity (#204)", () => {
  async function ssoOnlyUser(label: string, providerIds: string[]) {
    const user = await db.user.create({
      data: { id: `${tag}-${label}-${Date.now()}-${seq++}`, email: emailFor(label) },
    });
    const accounts = [];
    for (const p of providerIds) accounts.push(await addIdentity(user.id, p));
    return { user, accounts };
  }

  it("refuses to remove the last usable sign-in method", async () => {
    const { user, accounts } = await ssoOnlyUser("last", [idpKey]);
    expect((await listIdentities(user.id)).linked[0].canUnlink).toBe(false);
    expect(await unlinkIdentity(user.id, accounts[0].id)).toEqual({ ok: false, error: "LOCKOUT" });
    expect(await db.authAccount.count({ where: { id: accounts[0].id } })).toBe(1);
  });

  it("doesn't count an identity on a disabled provider as a way back in", async () => {
    const { user, accounts } = await ssoOnlyUser("disabled-other", [idpKey, offKey]);
    expect(await unlinkIdentity(user.id, accounts[0].id)).toEqual({ ok: false, error: "LOCKOUT" });
    const view = await listIdentities(user.id);
    expect(view.linked.find((i) => i.providerId === offKey)?.providerEnabled).toBe(false);
    // Removing the unusable one leaves the enabled identity.
    expect(await unlinkIdentity(user.id, accounts[1].id)).toEqual({ ok: true });
  });

  it("doesn't count an enabled provider the handler can't serve", async () => {
    await db.authProvider.create({
      data: { key: halfKey, type: "oidc", displayName: "Half", enabled: true, issuer },
    });
    try {
      const { user, accounts } = await ssoOnlyUser("unserved", [idpKey, halfKey]);
      expect(await unlinkIdentity(user.id, accounts[0].id)).toEqual({
        ok: false,
        error: "LOCKOUT",
      });
    } finally {
      await db.authProvider.deleteMany({ where: { key: halfKey } });
      invalidateAuthCache();
    }
  });

  it("counts a password only while credentials login is enabled", async () => {
    const user = await signedInUser("password");
    const account = await addIdentity(user.id, idpKey);
    try {
      await appSettings.set("credentials_enabled", false, actorId);
      expect(await unlinkIdentity(user.id, account.id)).toEqual({ ok: false, error: "LOCKOUT" });
    } finally {
      await appSettings.set("credentials_enabled", true, actorId);
    }
    actAs(user);
    expect(await unlinkIdentityAction(account.id)).toEqual({ ok: true });
    expect(await db.authAccount.count({ where: { id: account.id } })).toBe(0);
    const audit = await db.auditLog.findFirst({
      where: { userId: user.id, action: "auth.identity.unlinked" },
    });
    expect(audit?.metadata).toEqual({ providerId: idpKey });
  });

  it("keeps a passkey user unlinkable", async () => {
    const { user, accounts } = await ssoOnlyUser("passkey", [idpKey]);
    await db.passkey.create({
      data: {
        id: `${tag}-pk-${seq++}`,
        userId: user.id,
        publicKey: "pk",
        credentialID: `${tag}-cred-${seq++}`,
        counter: 0,
        deviceType: "singleDevice",
        backedUp: false,
      },
    });
    expect(await unlinkIdentity(user.id, accounts[0].id)).toEqual({ ok: true });
  });

  it("refuses another user's identity and the credential row", async () => {
    const { accounts } = await ssoOnlyUser("victim", [idpKey, otherKey]);
    const attacker = await signedInUser("attacker");
    expect(await unlinkIdentity(attacker.id, accounts[0].id)).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    const credential = await db.authAccount.findFirstOrThrow({
      where: { userId: attacker.id, providerId: "credential" },
    });
    expect(await unlinkIdentity(attacker.id, credential.id)).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
  });

  it("lets only one of two concurrent unlinks through when each relies on the other", async () => {
    const { user, accounts } = await ssoOnlyUser("race", [idpKey, otherKey]);
    const results = await Promise.all(accounts.map((a) => unlinkIdentity(user.id, a.id)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "LOCKOUT" }]);
    expect(await db.authAccount.count({ where: { userId: user.id } })).toBe(1);
  });

  it("serialises an unlink with a provider deletion that relies on it", async () => {
    await createAuthProvider(provider(tmpKey), { id: actorId });
    const { user, accounts } = await ssoOnlyUser("race-delete", [idpKey, tmpKey]);
    const [unlink, del] = await Promise.allSettled([
      unlinkIdentity(user.id, accounts[0].id),
      deleteAuthProvider(tmpKey, { id: actorId }),
    ]);
    const unlinked = unlink.status === "fulfilled" && unlink.value.ok;
    const deleted = del.status === "fulfilled";
    expect(unlinked !== deleted).toBe(true);
    expect(await db.authAccount.count({ where: { userId: user.id } })).toBe(1);
    await db.authProvider.deleteMany({ where: { key: tmpKey } });
    invalidateAuthCache();
  });
});

describe("Google link start (#204)", () => {
  it("returns Google's authorization URL with the social callback", async () => {
    // Only one Google row may exist: set any aside and put it back afterwards.
    const prior = await db.authProvider.findMany({ where: { type: "google" } });
    await db.authProvider.deleteMany({ where: { id: { in: prior.map((r) => r.id) } } });
    const row = await db.authProvider.create({
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
      const user = await signedInUser("google");
      actAs(user);
      const url = new URL(await startLink("google"));
      expect(url.origin).toBe("https://accounts.google.com");
      expect(url.searchParams.get("redirect_uri")).toBe(`${appUrl}/api/auth/callback/google`);
      const state = url.searchParams.get("state")!;
      const verification = await db.verification.findFirst({ where: { identifier: state } });
      expect(JSON.parse(verification!.value)).toMatchObject({
        callbackURL: "/fr/settings/security?linked=google",
        errorURL: "/fr/settings/security",
        link: { userId: user.id, email: user.email },
      });
    } finally {
      await db.authProvider.delete({ where: { id: row.id } });
      for (const r of prior) {
        await db.authProvider.create({ data: { ...r, config: r.config ?? Prisma.DbNull } });
      }
      invalidateAuthCache();
    }
  });
});
