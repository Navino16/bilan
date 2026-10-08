import { describe, it, expect } from "vitest";
import { countLockouts, type UserSignInMethods } from "@/server/services/settings/auth-providers";

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
