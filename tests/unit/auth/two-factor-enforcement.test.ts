import { describe, it, expect } from "vitest";
import { requiresTwoFactorSetup } from "@/server/auth/permissions";

const blocked = {
  isAdmin: true,
  twoFactorEnabled: false,
  hasPassword: true,
  passwordSignIn: true,
  settingOn: true,
};

describe("requiresTwoFactorSetup", () => {
  it("is true only for an admin with a password, when the setting is on and 2FA isn't enabled yet", () => {
    expect(requiresTwoFactorSetup(blocked)).toBe(true);
  });

  it("is false when the setting is off", () => {
    expect(requiresTwoFactorSetup({ ...blocked, settingOn: false })).toBe(false);
  });

  it("is false when 2FA is already enabled", () => {
    expect(requiresTwoFactorSetup({ ...blocked, twoFactorEnabled: true })).toBe(false);
  });

  it("is false for a non-admin", () => {
    expect(requiresTwoFactorSetup({ ...blocked, isAdmin: false })).toBe(false);
  });

  it("is false for an account without a password: its IdP's MFA is authoritative (#256)", () => {
    expect(requiresTwoFactorSetup({ ...blocked, hasPassword: false })).toBe(false);
  });

  it("is false while password sign-in is disabled: a dormant password guards no sign-in (#256)", () => {
    expect(requiresTwoFactorSetup({ ...blocked, passwordSignIn: false })).toBe(false);
  });
});
