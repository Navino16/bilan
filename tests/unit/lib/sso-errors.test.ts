import { describe, it, expect } from "vitest";
import { isOriginError, linkSsoError, loginSsoError } from "@/lib/sso-errors";
import fr from "../../../messages/fr.json";
import en from "../../../messages/en.json";

describe("loginSsoError", () => {
  it.each([
    ["BANNED_USER", "disabled"],
    ["signup_disabled", "ssoSignUpDisabled"],
    ["account_not_linked", "ssoNotLinked"],
    ["access_denied", "ssoDenied"],
    ["state_mismatch", "ssoExpired"],
    ["please_restart_the_process", "ssoExpired"],
    ["email_not_found", "ssoNoEmail"],
    ["email_is_missing", "ssoNoEmail"],
    ["invalid_code", "ssoProvider"],
    ["issuer_mismatch", "ssoProvider"],
    ["server_error", "ssoProvider"],
  ])("maps %s to %s", (code, key) => {
    expect(loginSsoError(code)).toBe(key);
  });

  it("keeps unknown codes generic", () => {
    expect(loginSsoError("<script>")).toBe("ssoFailed");
    expect(loginSsoError("constructor")).toBe("ssoFailed");
  });
});

describe("linkSsoError", () => {
  it.each([
    ["email_does_not_match", "emailMismatch"],
    ["account_already_linked_to_different_user", "linkedElsewhere"],
    ["access_denied", "denied"],
    ["state_mismatch", "expired"],
    ["email_is_missing", "noEmail"],
    ["oauth_code_verification_failed", "provider"],
    ["unable_to_link_account", "failed"],
    ["whatever", "failed"],
  ])("maps %s to %s", (code, key) => {
    expect(linkSsoError(code)).toBe(key);
  });
});

describe("isOriginError", () => {
  it("flags Better Auth's origin and callback URL refusals only", () => {
    expect(isOriginError("INVALID_ORIGIN")).toBe(true);
    expect(isOriginError("INVALID_CALLBACK_URL")).toBe(true);
    expect(isOriginError("INVALID_ERROR_CALLBACK_URL")).toBe(true);
    expect(isOriginError("PROVIDER_NOT_FOUND")).toBe(false);
    expect(isOriginError(undefined)).toBe(false);
  });
});

describe("SSO error messages", () => {
  const login = [
    "disabled",
    "ssoFailed",
    "ssoSignUpDisabled",
    "ssoNotLinked",
    "ssoDenied",
    "ssoProvider",
    "ssoExpired",
    "ssoNoEmail",
  ];
  const link = ["denied", "provider", "expired", "noEmail", "emailMismatch", "linkedElsewhere"];

  it.each([
    ["fr", fr],
    ["en", en],
  ])("exist in %s", (_, messages) => {
    for (const key of login) expect(messages.auth.login.error).toHaveProperty(key);
    for (const key of [...link, "failed"]) {
      expect(messages.settings.security.identitiesCard.linkError).toHaveProperty(key);
    }
  });
});
