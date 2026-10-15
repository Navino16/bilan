import { beforeEach, describe, expect, it, vi } from "vitest";

const sync = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/server/services/users/preferences", () => ({ syncPreferredLocale: sync }));

import { syncSsoSignInLocale, type HookContext } from "@/server/auth/auth-audit";

const callback = (
  path: string,
  headers: Record<string, string>,
  newSession: { user: { id: string } } | null,
) => ({ path, headers: new Headers(headers), context: { newSession } }) as unknown as HookContext;

const signedIn = { user: { id: "u1" } };
const fromIdp = { referer: "https://idp.example/authorize?client_id=x" };

describe("syncSsoSignInLocale (#245)", () => {
  beforeEach(() => sync.mockClear());

  it("stores the NEXT_LOCALE cookie's locale when the callback signs in, ignoring the IdP referer", async () => {
    await syncSsoSignInLocale(
      callback(
        "/oauth2/callback/:providerId",
        { ...fromIdp, cookie: "NEXT_LOCALE=en", "accept-language": "fr" },
        signedIn,
      ),
    );
    expect(sync).toHaveBeenCalledWith("u1", "en");
  });

  it("falls back to Accept-Language", async () => {
    await syncSsoSignInLocale(
      callback("/callback/:id", { ...fromIdp, "accept-language": "en-US,en;q=0.9" }, signedIn),
    );
    expect(sync).toHaveBeenCalledWith("u1", "en");
  });

  it("does nothing for a link callback, another route, or a request without a locale", async () => {
    await syncSsoSignInLocale(callback("/callback/:id", { cookie: "NEXT_LOCALE=en" }, null));
    await syncSsoSignInLocale(callback("/sign-in/social", { cookie: "NEXT_LOCALE=en" }, signedIn));
    await syncSsoSignInLocale(callback("/callback/:id", fromIdp, signedIn));
    expect(sync).not.toHaveBeenCalled();
  });
});
