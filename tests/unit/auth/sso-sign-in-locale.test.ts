import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const sync = vi.hoisted(() => vi.fn(async () => (calls.push("sync"), true)));
const logEvent = vi.hoisted(() => vi.fn(async () => {}));
const notify = vi.hoisted(() => vi.fn(async () => void calls.push("notify")));
vi.mock("@/server/services/users/preferences", () => ({ syncPreferredLocale: sync }));
vi.mock("@/server/services/audit", () => ({ logEvent }));
vi.mock("@/server/services/mail/security-notifications", () => ({ notifySecurityEvent: notify }));
const providers = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth/providers", () => ({ providerCache: { get: providers } }));
const oauthState = vi.hoisted(() => vi.fn(async (): Promise<object | null> => null));
vi.mock("better-auth/api", async (original) => ({
  ...(await original<typeof import("better-auth/api")>()),
  getOAuthState: oauthState,
}));

import { auditSsoCallback, markSsoSignUp, type HookContext } from "@/server/auth/auth-audit";

const callback = (
  path: string,
  headers: Record<string, string>,
  newSession: { user: { id: string; email: string } } | null,
  { providerId = "authentik", location }: { providerId?: string; location?: string } = {},
) =>
  ({
    path,
    params: { id: providerId },
    headers: new Headers(headers),
    context: { newSession, responseHeaders: new Headers(location ? { location } : {}) },
  }) as unknown as HookContext;

const signedIn = { user: { id: "u1", email: "u1@bilan.local" } };
const fromIdp = { referer: "https://idp.example/authorize?client_id=x" };

beforeEach(() => {
  calls.length = 0;
  sync.mockClear();
  logEvent.mockClear();
  notify.mockClear();
  providers.mockReset().mockResolvedValue([{ key: "authentik", displayName: "Authentik" }]);
  oauthState.mockReset().mockResolvedValue(null);
});

describe("SSO sign-in locale (#245)", () => {
  it("stores the NEXT_LOCALE cookie's locale when the callback signs in, ignoring the IdP referer", async () => {
    await auditSsoCallback(
      callback(
        "/callback/:id",
        { ...fromIdp, cookie: "NEXT_LOCALE=en", "accept-language": "fr" },
        signedIn,
      ),
    );
    expect(sync).toHaveBeenCalledWith("u1", "en");
  });

  it("falls back to Accept-Language", async () => {
    await auditSsoCallback(
      callback("/callback/:id", { ...fromIdp, "accept-language": "en-US,en;q=0.9" }, signedIn),
    );
    expect(sync).toHaveBeenCalledWith("u1", "en");
  });

  it("does nothing for a link callback, another route, or a request without a locale", async () => {
    await auditSsoCallback(callback("/callback/:id", { cookie: "NEXT_LOCALE=en" }, null));
    await auditSsoCallback(callback("/sign-in/social", { cookie: "NEXT_LOCALE=en" }, signedIn));
    await auditSsoCallback(callback("/callback/:id", fromIdp, signedIn));
    expect(sync).not.toHaveBeenCalled();
  });
});

describe("SSO sign-in audit and alert (#258)", () => {
  it("audits the sign-in, then mails the alert with the provider's name in the stored locale", async () => {
    await auditSsoCallback(callback("/callback/:id", { cookie: "NEXT_LOCALE=en" }, signedIn));
    expect(logEvent).toHaveBeenCalledWith({
      userId: "u1",
      action: "auth.login.success",
      metadata: { method: "sso", providerId: "authentik", email: "u1@bilan.local" },
    });
    expect(notify).toHaveBeenCalledWith(
      "new_login",
      expect.objectContaining({
        userId: "u1",
        pageLocale: "en",
        method: { kind: "sso", provider: "Authentik" },
      }),
    );
    expect(calls).toEqual(["sync", "notify"]);
  });

  it("audits a first sign-in that created the account as a sign-up, without an alert", async () => {
    const ctx = callback("/callback/:id", {}, signedIn);
    markSsoSignUp(ctx);
    await auditSsoCallback(ctx);
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", action: "auth.register.success" }),
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it("still mails the alert when the audit write or the provider lookup fails", async () => {
    logEvent.mockRejectedValueOnce(new Error("db down"));
    providers.mockRejectedValueOnce(new Error("db down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await auditSsoCallback(callback("/callback/:id", {}, signedIn));
    expect(notify).toHaveBeenCalledWith(
      "new_login",
      expect.objectContaining({ userId: "u1", method: { kind: "sso", provider: "SSO" } }),
    );
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("keeps an unknown provider id out of the audit log", async () => {
    oauthState.mockResolvedValue({});
    await auditSsoCallback(
      callback("/callback/:id", {}, null, {
        providerId: "x".repeat(500),
        location: "http://localhost:3000/login?error=please_restart_the_process",
      }),
    );
    expect(logEvent).toHaveBeenCalledWith({
      action: "auth.login.failed",
      metadata: { method: "sso", providerId: null, reason: "please_restart_the_process" },
    });
  });
});
