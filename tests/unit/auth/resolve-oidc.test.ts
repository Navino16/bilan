import { describe, it, expect } from "vitest";
import type { AuthProvider } from "@prisma/client";
import { resolveOidcProvider } from "@/server/auth/providers";
import { toOAuthConfig } from "@/server/auth";
import { encrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";

function row(overrides: Partial<AuthProvider>): AuthProvider {
  return {
    id: "p1",
    type: "oidc",
    key: "oidc",
    displayName: "SSO",
    enabled: true,
    issuer: "https://idp.example.com",
    clientId: "client",
    clientSecretEnc: encrypt("the-secret", dataKey),
    scopes: "openid,email",
    config: null,
    allowSignUp: false,
    updatedAt: new Date(0),
    updatedById: null,
    ...overrides,
  } as AuthProvider;
}

describe("resolveOidcProvider", () => {
  it("decrypts the secret and applies defaults when config is null", () => {
    const r = resolveOidcProvider(row({}));
    expect(r?.clientSecret).toBe("the-secret");
    expect(r?.scopes).toEqual(["openid", "email"]);
    expect(r?.pkce).toBeUndefined();
    expect(r?.authorizationUrl).toBeUndefined();
  });

  it("merges the advanced config (pkce, explicit endpoints, claim mapping)", () => {
    const r = resolveOidcProvider(
      row({
        config: {
          pkce: true,
          authorizationUrl: "https://idp.example.com/authorize",
          tokenUrl: "https://idp.example.com/token",
          userInfoUrl: "https://idp.example.com/userinfo",
          mapName: "given_name",
          mapEmail: "mail",
        } as never,
      }),
    );
    expect(r?.pkce).toBe(true);
    expect(r?.authorizationUrl).toBe("https://idp.example.com/authorize");
    expect(r?.tokenUrl).toBe("https://idp.example.com/token");
    expect(r?.userInfoUrl).toBe("https://idp.example.com/userinfo");
    expect(r?.mapName).toBe("given_name");
    expect(r?.mapEmail).toBe("mail");
  });

  it("returns null for non-oidc or incomplete rows", () => {
    expect(resolveOidcProvider(row({ type: "credentials" }))).toBeNull();
    expect(resolveOidcProvider(row({ clientSecretEnc: null }))).toBeNull();
  });

  it("refuses unknown IdP users unless the row allows sign-up (#200)", () => {
    const closed = toOAuthConfig(resolveOidcProvider(row({}))!, true);
    expect(closed.disableSignUp).toBe(true);
    expect(closed).not.toHaveProperty("disableImplicitSignUp");
    const open = toOAuthConfig(resolveOidcProvider(row({ allowSignUp: true }))!, true);
    expect(open.disableSignUp).toBe(false);
  });

  it("refuses unknown IdP users while registration is not open (#204)", () => {
    const allowed = resolveOidcProvider(row({ allowSignUp: true }))!;
    expect(toOAuthConfig(allowed, false).disableSignUp).toBe(true);
  });

  it("trusts email_verified only when literally true and about the mapped address (#240)", () => {
    const plain = toOAuthConfig(resolveOidcProvider(row({}))!, true).mapProfileToUser;
    expect(plain({ email: "a@x.test", email_verified: true })).toEqual({ emailVerified: true });
    for (const claim of [false, "true", "false", 1, undefined]) {
      expect(plain({ email: "a@x.test", email_verified: claim }).emailVerified).toBe(false);
    }
    const mapped = toOAuthConfig(
      resolveOidcProvider(row({ config: { mapEmail: "mail" } as never }))!,
      true,
    ).mapProfileToUser;
    expect(mapped({ email: "a@x.test", mail: "A@x.test", email_verified: true })).toEqual({
      email: "A@x.test",
      emailVerified: true,
    });
    expect(
      mapped({ email: "a@x.test", mail: "b@x.test", email_verified: true }).emailVerified,
    ).toBe(false);
    expect(
      mapped({ email: "a@x.test", mail: ["a@x.test"], email_verified: true }).emailVerified,
    ).toBe(false);
  });
});
