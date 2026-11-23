import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

vi.mock("@/server/services/mail/security-notifications", () => ({
  notifySecurityEvent: vi.fn(),
}));
type Mail = { to: string; subject: string; text: string };
const sent = vi.hoisted(() => [] as Mail[]);
vi.mock("@/server/services/mail/mailer", () => ({
  sendMail: async (mail: Mail) => {
    sent.push(mail);
    return { delivered: true };
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));
const grantFailures = vi.hoisted(() => ({ remaining: 0 }));
vi.mock("@/server/mcp/oauth-grants", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/mcp/oauth-grants")>();
  return {
    ...real,
    revokeAllOAuthGrants: vi.fn(async (...args: Parameters<typeof real.revokeAllOAuthGrants>) => {
      if (grantFailures.remaining > 0) {
        grantFailures.remaining--;
        throw new Error("grants down");
      }
      return real.revokeAllOAuthGrants(...args);
    }),
  };
});

import { env } from "@/env";
import { oauthRegisterLimiter } from "@/server/auth/rate-limit";
import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { appSettings } from "@/server/services/settings/app-settings";
import { setMcpEnabled } from "@/server/services/users/preferences";
import { changePassword } from "@/server/services/users/password";
import { revokeOtherSessions } from "@/server/services/users/sessions";
import { resolveMcpPrincipal } from "@/server/mcp/principal";
import {
  createMcpToken,
  hasLiveMcpCredentials,
  principalFromToken,
  revokeAllMcpCredentialsOrAudit,
} from "@/server/mcp/tokens";
import {
  clientRedirectHost,
  hasLiveOAuthGrants,
  listOAuthGrants,
  redirectHost,
  revokeAllOAuthGrants,
  revokeOAuthGrant,
} from "@/server/mcp/oauth-grants";
import { snapshotSetting } from "./support/app-setting-snapshot";
import {
  authorize,
  consent,
  exchangeCode,
  refreshTokens,
  registerClient,
  signInCookie,
  type OAuthTokens,
} from "./support/oauth-flow";

const tag = `oauth-grants-${Date.now()}`;
const password = "oauth-grants-password-1";
const appUrl = env.APP_URL.replace(/\/$/, "");
let restoreSwitch: () => Promise<void>;
const userIds: string[] = [];
let seq = 0;

type TestUser = { id: string; email: string; cookie: string };
type Pending = { clientId: string; redirectUri: string; code: string; verifier: string };
type Grant = { clientId: string; redirectUri: string; tokens: OAuthTokens };

async function makeUser(): Promise<TestUser> {
  const email = `${tag}-${seq++}@bilan.local`;
  const auth = await getAuth();
  const { user } = await auth.api.signUpEmail({ body: { email, password, name: "Grants" } });
  userIds.push(user.id);
  await setMcpEnabled(user.id, true, "en");
  await db.userPreference.updateMany({ where: { userId: user.id }, data: { locale: "en" } });
  return { id: user.id, email, cookie: await signInCookie(email, password) };
}

async function pendingCode(
  user: TestUser,
  scope = "bilan:read offline_access",
  name = `${tag}-client-${seq++}`,
  opts: { redirectUri?: string; extra?: Record<string, string> } = {},
): Promise<Pending> {
  const { clientId, redirectUri } = await registerClient({ name, redirectUri: opts.redirectUri });
  const { oauthQuery, verifier } = await authorize({
    clientId,
    redirectUri,
    cookie: user.cookie,
    scope,
    extra: opts.extra,
  });
  const { code } = await consent({ oauthQuery, cookie: user.cookie });
  return { clientId, redirectUri, code, verifier };
}

async function grant(
  user: TestUser,
  scope?: string,
  name?: string,
  redirectUri?: string,
): Promise<Grant> {
  const { clientId, code, verifier, ...rest } = await pendingCode(user, scope, name, {
    redirectUri,
  });
  const redirect = rest.redirectUri;
  return {
    clientId,
    redirectUri: redirect,
    tokens: await exchangeCode({ clientId, redirectUri: redirect, code, verifier }),
  };
}

const headersOf = (user: TestUser) =>
  new Headers({ cookie: user.cookie, "x-forwarded-for": "203.0.113.9" });

async function expectDead(g: Grant): Promise<void> {
  expect(await resolveMcpPrincipal(g.tokens.access_token)).toBeNull();
  await expect(
    refreshTokens({ clientId: g.clientId, refreshToken: g.tokens.refresh_token! }),
  ).rejects.toThrow(/token request failed/);
}

const expectCodeRefused = (p: Pending) => expect(exchangeCode(p)).rejects.toThrow(/invalid/);

const revokedAll = (userId: string, reason: string) =>
  db.auditLog.count({
    where: {
      userId,
      action: "mcp.client.revoked_all",
      metadata: { path: "$.reason", equals: reason },
    },
  });

async function resetPassword(user: TestUser, newPassword: string): Promise<void> {
  const auth = await getAuth();
  sent.length = 0;
  await auth.api.requestPasswordReset({
    body: { email: user.email, redirectTo: `${appUrl}/en/reset` },
  });
  const mail = await vi.waitFor(() => {
    const m = sent.find((x) => x.to === user.email);
    if (!m) throw new Error("reset mail not sent yet");
    return m;
  });
  const link = mail.text.split("\n").find((l) => l.startsWith(`${appUrl}/en/reset/`));
  const token = decodeURIComponent(link!.split("/").pop()!);
  await auth.api.resetPassword({ body: { newPassword, token } });
}

beforeAll(async () => {
  restoreSwitch = await snapshotSetting("mcp_enabled");
  await appSettings.set("mcp_enabled", true, (await makeUser()).id);
});

afterEach(() => {
  grantFailures.remaining = 0;
  oauthRegisterLimiter.reset("unknown");
  vi.restoreAllMocks();
});

afterAll(async () => {
  await db.oauthClient.deleteMany({ where: { name: { startsWith: tag } } });
  for (const id of userIds) {
    await db.verification.deleteMany({ where: { value: { contains: `"userId":"${id}"` } } });
  }
  await restoreSwitch();
  await db.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("listOAuthGrants", () => {
  it("lists one row per consent, newest first, with access, offline and redirect host", async () => {
    const user = await makeUser();
    const longName = `${tag}-long-`.padEnd(200, "n");
    const read = await grant(user, "bilan:read offline_access", longName);
    await db.oauthConsent.updateMany({
      where: { userId: user.id, clientId: read.clientId },
      data: { updatedAt: new Date(Date.now() - 60_000) },
    });
    const write = await grant(user, "bilan:write");

    const rows = await listOAuthGrants(user.id);
    expect(rows.map((r) => r.clientId)).toEqual([write.clientId, read.clientId]);
    expect(rows[1]).toMatchObject({
      clientId: read.clientId,
      name: longName.slice(0, 80),
      redirectHost: "127.0.0.1:43123",
      access: "read",
      offline: true,
    });
    expect(rows[1].name).toHaveLength(80);
    expect(rows[1].authorizedAt).toBeInstanceOf(Date);
    expect(rows[0]).toMatchObject({ access: "write", offline: false });
    expect(await hasLiveOAuthGrants(user.id)).toBe(true);
  });
});

describe("redirect host", () => {
  it("shows the scheme of private-use redirect URIs", async () => {
    const user = await makeUser();
    const g = await grant(user, "bilan:read", undefined, "com.example.app:/cb");
    expect((await listOAuthGrants(user.id)).find((r) => r.clientId === g.clientId)).toMatchObject({
      redirectHost: "com.example.app:",
    });
    expect(redirectHost("cursor://anysphere.cursor-retrieval/oauth/callback")).toBe(
      "cursor://anysphere.cursor-retrieval",
    );
    expect(redirectHost("evil://claude.ai/cb")).toBe("evil://claude.ai");
    expect(redirectHost("http://127.0.0.1:43123/callback")).toBe("127.0.0.1:43123");
    expect(clientRedirectHost(JSON.stringify(["https://mcp.example.com:8443/cb"]))).toBe(
      "mcp.example.com:8443",
    );
    expect(redirectHost("not a url")).toBeNull();
  });
});

describe("hasLiveOAuthGrants", () => {
  // A re-consent of the same client would revive the orphan token (spec §5.18).
  it("counts a token whose consent is gone", async () => {
    const user = await makeUser();
    const g = await grant(user, "bilan:read");
    await db.oauthConsent.deleteMany({ where: { userId: user.id } });
    expect(await resolveMcpPrincipal(g.tokens.access_token)).toBeNull();
    expect(await hasLiveOAuthGrants(user.id)).toBe(true);
    expect(await revokeAllOAuthGrants(user.id, "sessions")).toBe(1);
    expect(await hasLiveOAuthGrants(user.id)).toBe(false);
  });
});

describe("revokeOAuthGrant", () => {
  it("kills the client's tokens and consent, audits, and leaves the other client alone", async () => {
    const user = await makeUser();
    const target = await grant(user);
    const other = await grant(user);

    await revokeOAuthGrant(user.id, target.clientId);
    await expectDead(target);
    expect((await listOAuthGrants(user.id)).map((r) => r.clientId)).toEqual([other.clientId]);
    expect(
      await db.auditLog.count({
        where: {
          userId: user.id,
          action: "mcp.client.revoked",
          entity: "OauthClient",
          entityId: target.clientId,
        },
      }),
    ).toBe(1);
    expect(await db.oauthClient.count({ where: { clientId: target.clientId } })).toBe(1);

    expect(await resolveMcpPrincipal(other.tokens.access_token)).toMatchObject({
      userId: user.id,
    });
    const refreshed = await refreshTokens({
      clientId: other.clientId,
      refreshToken: other.tokens.refresh_token!,
    });
    expect(await resolveMcpPrincipal(refreshed.access_token)).toMatchObject({ userId: user.id });
  });

  it("refuses another user's client and an already revoked one", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const g = await grant(owner);
    await expect(revokeOAuthGrant(stranger.id, g.clientId)).rejects.toThrow("NOT_FOUND");
    expect(await resolveMcpPrincipal(g.tokens.access_token)).not.toBeNull();
    await revokeOAuthGrant(owner.id, g.clientId);
    await expect(revokeOAuthGrant(owner.id, g.clientId)).rejects.toThrow("NOT_FOUND");
  });

  it("refuses a code issued but not yet exchanged", async () => {
    const user = await makeUser();
    const pending = await pendingCode(user);
    await revokeOAuthGrant(user.id, pending.clientId);
    await expectCodeRefused(pending);
  });
});

describe("pending codes", () => {
  it("ignores another user's code whose query carries the victim's id", async () => {
    const victim = await makeUser();
    const attacker = await makeUser();
    const planted = await pendingCode(attacker, undefined, undefined, {
      extra: { userId: victim.id },
    });
    expect(
      await db.verification.count({
        where: { value: { contains: `"userId":"${victim.id}"` } },
      }),
    ).toBe(1);

    expect(await hasLiveOAuthGrants(victim.id)).toBe(false);
    await expect(revokeOAuthGrant(victim.id, planted.clientId)).rejects.toThrow("NOT_FOUND");
    expect(await revokeAllOAuthGrants(victim.id, "password")).toBe(0);
    expect((await exchangeCode(planted)).access_token).toBeTruthy();
  });
});

describe("credential lifecycle (spec §5.18)", () => {
  it("a password change revokes grants, pending codes and personal tokens", async () => {
    const user = await makeUser();
    const g = await grant(user);
    const pending = await pendingCode(user);
    const pat = await createMcpToken(user.id, { name: "t", scope: "read" });

    const res = await changePassword(headersOf(user), {
      currentPassword: password,
      newPassword: "oauth-grants-password-2",
      revokeOtherSessions: false,
    });
    expect(res).toEqual({ ok: true });
    await expectDead(g);
    await expectCodeRefused(pending);
    expect(await principalFromToken(pat.token)).toBeNull();
    expect(await listOAuthGrants(user.id)).toEqual([]);
    expect(await revokedAll(user.id, "password")).toBe(1);
    expect(await hasLiveMcpCredentials(user.id)).toBe(false);
  });

  it("a password reset revokes grants and personal tokens", async () => {
    const user = await makeUser();
    const g = await grant(user);
    const pat = await createMcpToken(user.id, { name: "t", scope: "write" });

    await resetPassword(user, "oauth-grants-password-3");
    await expectDead(g);
    expect(await principalFromToken(pat.token)).toBeNull();
    expect(await revokedAll(user.id, "password")).toBe(1);
  });

  it("signing out everywhere revokes grants and personal tokens", async () => {
    const user = await makeUser();
    const g = await grant(user);
    const pending = await pendingCode(user);
    const pat = await createMcpToken(user.id, { name: "t", scope: "read" });

    expect((await revokeOtherSessions(headersOf(user))).ok).toBe(true);
    await expectDead(g);
    await expectCodeRefused(pending);
    expect(await principalFromToken(pat.token)).toBeNull();
    expect(await revokedAll(user.id, "sessions")).toBe(1);
  });

  it("revokeAllOAuthGrants counts clients and audits only when there were some", async () => {
    const user = await makeUser();
    await grant(user);
    await grant(user);
    expect(await revokeAllOAuthGrants(user.id, "sessions")).toBe(2);
    expect(await revokeAllOAuthGrants(user.id, "sessions")).toBe(0);
    expect(await revokedAll(user.id, "sessions")).toBe(1);
    expect(await hasLiveOAuthGrants(user.id)).toBe(false);
  });
});

describe("failed revocation", () => {
  const failures = (userId: string) =>
    db.auditLog.count({ where: { userId, action: "mcp.credentials.revoke_failed" } });
  const quietErrors = () => vi.spyOn(console, "error").mockImplementation(() => {});

  it("retries once, then audits the failure and reports the credentials live", async () => {
    const user = await makeUser();
    const g = await grant(user);
    quietErrors();
    grantFailures.remaining = 2;
    expect(await revokeAllMcpCredentialsOrAudit(user.id, "sessions")).toBe(false);
    expect(await failures(user.id)).toBe(1);
    expect(await resolveMcpPrincipal(g.tokens.access_token)).not.toBeNull();
    expect(await hasLiveMcpCredentials(user.id)).toBe(true);

    grantFailures.remaining = 1;
    expect(await revokeAllMcpCredentialsOrAudit(user.id, "sessions")).toBe(true);
    expect(await resolveMcpPrincipal(g.tokens.access_token)).toBeNull();
  });

  it("revokes the grants even when the personal tokens can't be", async () => {
    const user = await makeUser();
    const g = await grant(user);
    const pat = await createMcpToken(user.id, { name: "t", scope: "read" });
    quietErrors();
    const updateMany = vi.spyOn(db.mcpToken, "updateMany").mockRejectedValue(new Error("db down"));
    expect(await revokeAllMcpCredentialsOrAudit(user.id, "sessions")).toBe(false);
    expect(updateMany).toHaveBeenCalledTimes(2);
    await expectDead(g);
    expect(await failures(user.id)).toBe(1);
    expect(await principalFromToken(pat.token)).not.toBeNull();
  });

  it("the password form answers TOKENS_FAILED while a grant stays live", async () => {
    const user = await makeUser();
    await grant(user);
    await createMcpToken(user.id, { name: "t", scope: "read" });
    quietErrors();
    grantFailures.remaining = 2;
    const res = await changePassword(headersOf(user), {
      currentPassword: password,
      newPassword: "oauth-grants-password-4",
      revokeOtherSessions: false,
    });
    expect(res).toEqual({ ok: false, error: "TOKENS_FAILED" });
    expect(await failures(user.id)).toBe(1);
  });

  it("signing out everywhere answers TOKENS_FAILED while a grant stays live", async () => {
    const user = await makeUser();
    await grant(user);
    quietErrors();
    grantFailures.remaining = 2;
    expect(await revokeOtherSessions(headersOf(user))).toEqual({
      ok: false,
      error: "TOKENS_FAILED",
    });
    expect(await failures(user.id)).toBe(1);
  });
});

describe("user switch", () => {
  it("keeps grants while off and restores them when back on", async () => {
    const user = await makeUser();
    const g = await grant(user);
    const before = await listOAuthGrants(user.id);
    await setMcpEnabled(user.id, false, "en");
    expect(await listOAuthGrants(user.id)).toEqual(before);
    expect(await resolveMcpPrincipal(g.tokens.access_token)).toBeNull();
    await setMcpEnabled(user.id, true, "en");
    expect(await resolveMcpPrincipal(g.tokens.access_token)).toMatchObject({ userId: user.id });
  });
});
