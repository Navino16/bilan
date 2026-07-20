import { describe, it, expect } from "vitest";
import { requiresTwoFactorSetup } from "@/server/auth/permissions";

describe("requiresTwoFactorSetup", () => {
  it("is true only for an admin, when the setting is on and 2FA isn't enabled yet", () => {
    expect(requiresTwoFactorSetup({ isAdmin: true, twoFactorEnabled: false, settingOn: true })).toBe(
      true,
    );
  });

  it("is false when the setting is off", () => {
    expect(
      requiresTwoFactorSetup({ isAdmin: true, twoFactorEnabled: false, settingOn: false }),
    ).toBe(false);
  });

  it("is false when 2FA is already enabled", () => {
    expect(requiresTwoFactorSetup({ isAdmin: true, twoFactorEnabled: true, settingOn: true })).toBe(
      false,
    );
  });

  it("is false for a non-admin", () => {
    expect(
      requiresTwoFactorSetup({ isAdmin: false, twoFactorEnabled: false, settingOn: true }),
    ).toBe(false);
  });
});
