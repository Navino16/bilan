import { describe, it, expect } from "vitest";
import {
  countCredentialLockouts,
  countLockouts,
  hasUsableSignIn,
  type UserSignInMethods,
} from "@/server/services/settings/auth-providers";

const user = (u: Partial<UserSignInMethods>): UserSignInMethods => ({
  providerIds: ["idp"],
  hasPassword: false,
  hasPasskey: false,
  ...u,
});
const usable = (credentialsEnabled = true, enabled: string[] = []) => ({
  credentialsEnabled,
  enabledProviderIds: new Set(enabled),
});

describe("countLockouts", () => {
  it("counts a user whose only sign-in method is the removed provider", () => {
    expect(countLockouts([user({})], "idp", usable())).toBe(1);
  });

  it("keeps users with a password only while credentials login is enabled", () => {
    const u = user({ providerIds: ["idp", "credential"], hasPassword: true });
    expect(countLockouts([u], "idp", usable(true))).toBe(0);
    expect(countLockouts([u], "idp", usable(false))).toBe(1);
  });

  it("keeps users with a passkey", () => {
    expect(countLockouts([user({ hasPasskey: true })], "idp", usable(false))).toBe(0);
  });

  it("keeps users linked to another provider only if that provider is enabled", () => {
    const u = user({ providerIds: ["idp", "google"] });
    expect(countLockouts([u], "idp", usable(true, ["google"]))).toBe(0);
    expect(countLockouts([u], "idp", usable(true, []))).toBe(1);
  });

  it("never counts the removed provider itself as an alternative", () => {
    expect(countLockouts([user({})], "idp", usable(true, ["idp"]))).toBe(1);
  });
});

describe("hasUsableSignIn", () => {
  it("is false with no method left", () => {
    expect(hasUsableSignIn(user({ providerIds: [] }), usable(true, ["idp"]))).toBe(false);
  });

  it("ignores identities on disabled providers and the password when credentials are off", () => {
    const u = user({ providerIds: ["credential", "idp"], hasPassword: true });
    expect(hasUsableSignIn(u, usable(false, []))).toBe(false);
    expect(hasUsableSignIn(u, usable(false, ["idp"]))).toBe(true);
    expect(hasUsableSignIn(u, usable(true, []))).toBe(true);
  });

  it("never treats the credential row itself as a provider", () => {
    expect(hasUsableSignIn(user({ providerIds: ["credential"] }), usable(false, []))).toBe(false);
  });
});

describe("countCredentialLockouts (#255)", () => {
  it("counts users whose password is their only usable method", () => {
    const pw = user({ providerIds: ["credential"], hasPassword: true });
    expect(countCredentialLockouts([pw], usable(true))).toBe(1);
  });

  it("keeps users with a passkey or an identity on an enabled provider", () => {
    const withPasskey = user({ providerIds: ["credential"], hasPassword: true, hasPasskey: true });
    const withIdp = user({ providerIds: ["credential", "idp"], hasPassword: true });
    expect(countCredentialLockouts([withPasskey, withIdp], usable(true, ["idp"]))).toBe(0);
    expect(countCredentialLockouts([withIdp], usable(true, []))).toBe(1);
  });

  it("ignores users without a password, who lose nothing", () => {
    expect(countCredentialLockouts([user({ providerIds: [] })], usable(true))).toBe(0);
  });
});
