import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const sync = vi.hoisted(() => vi.fn(async () => (calls.push("sync"), true)));
const logEvent = vi.hoisted(() => vi.fn(async () => {}));
const notify = vi.hoisted(() => vi.fn(async () => void calls.push("notify")));
vi.mock("@/server/services/users/preferences", () => ({ syncPreferredLocale: sync }));
vi.mock("@/server/services/audit", () => ({ logEvent }));
vi.mock("@/server/services/mail/security-notifications", () => ({ notifySecurityEvent: notify }));
vi.mock("@/server/auth/providers", () => ({
  providerCache: { get: async () => [{ key: "authentik", displayName: "Authentik" }] },
}));

import { auditSsoCallback, markSsoSignUp, type HookContext } from "@/server/auth/auth-audit";

const callback = (
  path: string,
  headers: Record<string, string>,
  newSession: { user: { id: string; email: string } } | null,
) =>
  ({
    path,
    params: { providerId: "authentik" },
    headers: new Headers(headers),
    context: { newSession },
  }) as unknown as HookContext;

const signedIn = { user: { id: "u1", email: "u1@bilan.local" } };
const fromIdp = { referer: "https://idp.example/authorize?client_id=x" };

beforeEach(() => {
  calls.length = 0;
  sync.mockClear();
  logEvent.mockClear();
  notify.mockClear();
});

describe("SSO sign-in locale (#245)", () => {
  it("stores the NEXT_LOCALE cookie's locale when the callback signs in, ignoring the IdP referer", async () => {
    await auditSsoCallback(
      callback(
        "/oauth2/callback/:providerId",
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
    await auditSsoCallback(
      callback("/oauth2/callback/:providerId", { cookie: "NEXT_LOCALE=en" }, signedIn),
    );
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
    const ctx = callback("/oauth2/callback/:providerId", {}, signedIn);
    markSsoSignUp(ctx);
    await auditSsoCallback(ctx);
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", action: "auth.register.success" }),
    );
    expect(notify).not.toHaveBeenCalled();
  });
});
