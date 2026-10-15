import { describe, it, expect } from "vitest";
import { resetLink, resetRequest } from "@/server/services/mail/password-reset";

const app = "https://bilan.example.com";
const api = (callback: string) =>
  `${app}/api/auth/reset-password/tok?callbackURL=${encodeURIComponent(callback)}`;
const fallback = { locale: "fr", kind: "reset" };

describe("resetRequest", () => {
  it("reads the requesting page's locale", () => {
    expect(resetRequest(api(`${app}/en/reset`), app)).toEqual({ locale: "en", kind: "reset" });
    expect(resetRequest(api("/fr/reset/"), `${app}/`)).toEqual(fallback);
  });

  it("flags the admin-provisioned setup flow", () => {
    expect(resetRequest(api(`${app}/en/reset?setup=1`), app)).toEqual({
      locale: "en",
      kind: "setup",
    });
  });

  it("ignores foreign hosts, other same-origin paths and missing targets", () => {
    expect(resetRequest(api("https://evil.example/en/reset"), app)).toEqual(fallback);
    expect(resetRequest(api("//evil.example/en/reset"), app)).toEqual(fallback);
    expect(resetRequest(api(`${app}/en/dashboard`), app)).toEqual(fallback);
    expect(resetRequest(`${app}/api/auth/reset-password/tok`, app)).toEqual(fallback);
    expect(resetRequest("not a url", app)).toEqual(fallback);
  });
});

describe("resetLink", () => {
  it("targets our reset page in the given locale and encodes the token", () => {
    expect(resetLink("tok", "en", `${app}/`)).toBe(`${app}/en/reset/tok`);
    expect(resetLink("a/b?c", "fr", app)).toBe(`${app}/fr/reset/a%2Fb%3Fc`);
  });
});
