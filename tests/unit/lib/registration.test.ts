import { describe, it, expect } from "vitest";
import { isRegistrationClosed } from "@/lib/registration";

describe("isRegistrationClosed (#255)", () => {
  const open = { mode: "OPEN", credentialsEnabled: true, signUpProviders: 0 };

  it("is open while password sign-up is offered in OPEN or INVITE_ONLY mode", () => {
    expect(isRegistrationClosed(open)).toBe(false);
    expect(isRegistrationClosed({ ...open, mode: "INVITE_ONLY" })).toBe(false);
  });

  it("is closed in DISABLED mode, or any unknown mode", () => {
    expect(isRegistrationClosed({ ...open, mode: "DISABLED" })).toBe(true);
    expect(isRegistrationClosed({ ...open, mode: "bogus" })).toBe(true);
  });

  it("without password sign-in, is only open through an SSO provider allowing sign-up in OPEN mode", () => {
    const noPassword = { ...open, credentialsEnabled: false };
    expect(isRegistrationClosed(noPassword)).toBe(true);
    expect(isRegistrationClosed({ ...noPassword, signUpProviders: 1 })).toBe(false);
    expect(isRegistrationClosed({ ...noPassword, mode: "INVITE_ONLY", signUpProviders: 1 })).toBe(
      true,
    );
  });
});
