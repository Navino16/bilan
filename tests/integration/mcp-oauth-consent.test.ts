import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";

// The Server Actions read the session through next/headers.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => request.headers,
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));
const consentFailures = vi.hoisted(() => ({ grant: false, deny: false }));
vi.mock("@/server/mcp/oauth-consent", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/mcp/oauth-consent")>();
  return {
    ...real,
    grantOAuthConsent: vi.fn(async (...args: Parameters<typeof real.grantOAuthConsent>) => {
      if (consentFailures.grant) throw new Error("plugin down");
      return real.grantOAuthConsent(...args);
    }),
    denyOAuthConsent: vi.fn(async (...args: Parameters<typeof real.denyOAuthConsent>) => {
      if (consentFailures.deny) throw new Error("plugin down");
      return real.denyOAuthConsent(...args);
    }),
  };
});

import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { changePasswordLimiter } from "@/server/auth/rate-limit";
import { appSettings } from "@/server/services/settings/app-settings";
import { setMcpEnabled } from "@/server/services/users/preferences";
import { RECENT_SIGN_IN_MS } from "@/server/services/users/step-up";
import { approveOAuthConsentAction, denyOAuthConsentAction } from "@/server/transport/actions/mcp";
import { loginAction } from "@/server/transport/actions/auth";
import { oauthIssuer } from "@/server/mcp/oauth-config";
import { snapshotSetting } from "./support/app-setting-snapshot";
import { authorize, exchangeCode, registerClient, signInCookie } from "./support/oauth-flow";

vi.setConfig({ testTimeout: 20_000 });

const tag = `oauth-consent-${Date.now()}`;
const email = `${tag}@bilan.local`;
const password = "oauth-consent-password-1";
const userAgent = "Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0";
let userId: string;
let restoreSwitch: () => Promise<void>;
let seq = 0;

async function signIn(): Promise<string> {
  const cookie = await signInCookie(email, password);
  request.headers = new Headers({
    cookie,
    "user-agent": userAgent,
    "x-forwarded-for": "203.0.113.9",
  });
  return cookie;
}

async function ageSessions(ms = RECENT_SIGN_IN_MS + 60_000): Promise<void> {
  await db.session.updateMany({
    where: { userId },
    data: { createdAt: new Date(Date.now() - ms) },
  });
}

async function pending(scope: string, extra?: Record<string, string>) {
  const cookie = await signIn();
  const client = await registerClient({ name: `${tag}-client-${seq++}` });
  const flow = await authorize({ ...client, cookie, scope, extra });
  return { ...client, ...flow };
}

const consents = (clientId: string) => db.oauthConsent.count({ where: { userId, clientId } });

beforeAll(async () => {
  const auth = await getAuth();
  userId = (await auth.api.signUpEmail({ body: { email, password, name: "Consent" } })).user.id;
  restoreSwitch = await snapshotSetting("mcp_enabled");
  await appSettings.set("mcp_enabled", true, userId);
});

beforeEach(async () => {
  changePasswordLimiter.reset(userId);
  await appSettings.set("mcp_enabled", true, userId);
  await setMcpEnabled(userId, true, "en");
  await db.auditLog.deleteMany({ where: { userId } });
});

afterEach(() => {
  consentFailures.grant = false;
  consentFailures.deny = false;
  vi.restoreAllMocks();
});

afterAll(async () => {
  changePasswordLimiter.reset(userId);
  await restoreSwitch();
  await db.oauthClient.deleteMany({ where: { name: { startsWith: tag } } });
  await db.verification.deleteMany({
    where: { OR: [{ value: userId }, { value: { contains: `"userId":"${userId}"` } }] },
  });
  await db.auditLog.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
});

describe("approveOAuthConsentAction", () => {
  it("grants read only on a fresh session and audits the authorization", async () => {
    const p = await pending("bilan:read bilan:write");
    const res = await approveOAuthConsentAction({ oauthQuery: p.oauthQuery, access: "read" });
    expect(res.ok).toBe(true);
    const url = new URL((res as { url: string }).url);
    expect(`${url.origin}${url.pathname}`).toBe(p.redirectUri);
    expect(url.searchParams.get("state")).toBe(p.state);
    expect(url.searchParams.get("iss")).toBe(oauthIssuer());
    const tokens = await exchangeCode({ ...p, code: url.searchParams.get("code")! });
    expect(tokens.scope.split(" ")).toEqual(["bilan:read"]);

    const audits = await db.auditLog.findMany({
      where: { userId, action: "mcp.client.authorized" },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      entity: "OauthClient",
      entityId: p.clientId,
      ipAddress: "203.0.113.9",
      userAgent,
      metadata: {
        clientId: p.clientId,
        name: expect.stringMatching(new RegExp(`^${tag}-client-`)),
        redirectHost: "127.0.0.1:43123",
        scopes: ["bilan:read"],
        via: "recent_sign_in",
      },
    });
  });

  it("asks an older session for the password before granting", async () => {
    const p = await pending("bilan:read offline_access");
    await ageSessions();
    const input = { oauthQuery: p.oauthQuery, access: "read" as const };
    expect(await approveOAuthConsentAction(input)).toEqual({
      ok: false,
      error: "REAUTH_REQUIRED",
      method: "PASSWORD",
    });
    expect(await approveOAuthConsentAction(input, "wrong-password")).toEqual({
      ok: false,
      error: "BAD_PASSWORD",
    });
    const refused = await db.auditLog.findMany({
      where: { userId, action: "mcp.client.authorize_failed" },
    });
    expect(refused).toMatchObject([
      { entity: "OauthClient", entityId: p.clientId, metadata: { reason: "bad_password" } },
    ]);
    expect(await consents(p.clientId)).toBe(0);

    const res = await approveOAuthConsentAction(input, password);
    expect(res.ok).toBe(true);
    const audit = await db.auditLog.findFirst({
      where: { userId, action: "mcp.client.authorized" },
    });
    expect(audit?.metadata).toMatchObject({
      scopes: ["bilan:read", "offline_access"],
      via: "password",
    });
  });

  it("refuses when the user's switch is off", async () => {
    const p = await pending("bilan:read");
    await setMcpEnabled(userId, false, "en");
    expect(await approveOAuthConsentAction({ oauthQuery: p.oauthQuery, access: "read" })).toEqual({
      ok: false,
      error: "MCP_DISABLED",
    });
    expect(await consents(p.clientId)).toBe(0);
  });

  it("refuses when the instance switch is off", async () => {
    const p = await pending("bilan:read");
    await appSettings.set("mcp_enabled", false, userId);
    expect(await approveOAuthConsentAction({ oauthQuery: p.oauthQuery, access: "read" })).toEqual({
      ok: false,
      error: "INSTANCE_DISABLED",
    });
  });

  it("refuses a tampered query", async () => {
    const p = await pending("bilan:read");
    const tampered = new URLSearchParams(p.oauthQuery);
    tampered.set("scope", "bilan:read bilan:write");
    expect(
      await approveOAuthConsentAction({ oauthQuery: tampered.toString(), access: "write" }),
    ).toEqual({ ok: false, error: "INVALID" });
    expect(await consents(p.clientId)).toBe(0);
  });

  it("refuses a request without any Bilan scope", async () => {
    const p = await pending("offline_access");
    expect(await approveOAuthConsentAction({ oauthQuery: p.oauthQuery, access: "read" })).toEqual({
      ok: false,
      error: "NO_SCOPE",
    });
    expect(await approveOAuthConsentAction({ oauthQuery: p.oauthQuery, access: "write" })).toEqual({
      ok: false,
      error: "NO_SCOPE",
    });
  });

  it("asks for a new sign-in when the client sent prompt=login", async () => {
    const p = await pending("bilan:read", { prompt: "login" });
    await ageSessions(60_000);
    expect(await approveOAuthConsentAction({ oauthQuery: p.oauthQuery, access: "read" })).toEqual({
      ok: false,
      error: "LOGIN_REQUIRED",
    });
    expect(await consents(p.clientId)).toBe(0);
  });

  it("asks for a new sign-in after the password when the client sent prompt=login", async () => {
    const p = await pending("bilan:read", { prompt: "login" });
    await ageSessions();
    const input = { oauthQuery: p.oauthQuery, access: "read" as const };
    expect(await approveOAuthConsentAction(input)).toMatchObject({ error: "REAUTH_REQUIRED" });
    expect(await approveOAuthConsentAction(input, password)).toEqual({
      ok: false,
      error: "LOGIN_REQUIRED",
    });
    expect(await consents(p.clientId)).toBe(0);
  });

  it("logs an unexpected failure and answers FAILED", async () => {
    const p = await pending("bilan:read");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    consentFailures.grant = true;
    expect(await approveOAuthConsentAction({ oauthQuery: p.oauthQuery, access: "read" })).toEqual({
      ok: false,
      error: "FAILED",
    });
    expect(log).toHaveBeenCalledWith("[bilan] OAuth consent failed", "Error");
  });

  it("still returns the redirect when the authorization audit fails", async () => {
    const p = await pending("bilan:read");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(db.auditLog, "create").mockRejectedValueOnce(new Error("db down"));
    const res = await approveOAuthConsentAction({ oauthQuery: p.oauthQuery, access: "read" });
    expect(res).toEqual({ ok: true, url: expect.stringContaining("code=") });
    expect(await consents(p.clientId)).toBe(1);
    expect(log).toHaveBeenCalled();
  });
});

describe("denyOAuthConsentAction", () => {
  it("sends the client access_denied with its state and stores no consent", async () => {
    const p = await pending("bilan:read bilan:write");
    const res = await denyOAuthConsentAction(p.oauthQuery);
    expect(res.ok).toBe(true);
    const url = new URL((res as { url: string }).url);
    expect(`${url.origin}${url.pathname}`).toBe(p.redirectUri);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe(p.state);
    expect(await consents(p.clientId)).toBe(0);
  });

  it("refuses when the instance switch is off", async () => {
    const p = await pending("bilan:read");
    await appSettings.set("mcp_enabled", false, userId);
    expect(await denyOAuthConsentAction(p.oauthQuery)).toEqual({
      ok: false,
      error: "INSTANCE_DISABLED",
    });
  });

  it("logs an unexpected failure and answers FAILED", async () => {
    const p = await pending("bilan:read");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    consentFailures.deny = true;
    expect(await denyOAuthConsentAction(p.oauthQuery)).toEqual({ ok: false, error: "FAILED" });
    expect(log).toHaveBeenCalledWith("[bilan] OAuth consent failed", "Error");
  });

  it("refuses a tampered query", async () => {
    const p = await pending("bilan:read");
    expect(await denyOAuthConsentAction(`${p.oauthQuery}&state=x`)).toEqual({
      ok: false,
      error: "INVALID",
    });
  });
});

// The plugin re-runs /oauth2/authorize after a sign-in whose body carries `oauth_query`;
// Bilan's login returns through `callbackUrl` instead and must not trigger it.
describe("login round trip", () => {
  it("signs in even if the instance switch went off after the authorization started", async () => {
    const p = await pending("bilan:read");
    await appSettings.set("mcp_enabled", false, userId);
    request.headers = new Headers({ "user-agent": userAgent, "x-forwarded-for": "203.0.113.9" });
    const form = new FormData();
    form.set("email", email);
    form.set("password", password);
    form.set("oauth_query", p.oauthQuery);
    expect(await loginAction(undefined as never, form)).toEqual({ ok: true });
  });
});
