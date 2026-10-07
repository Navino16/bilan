import { describe, it, expect } from "vitest";
import { resetLink } from "@/server/services/mail/password-reset";

const app = "https://bilan.example.com";
const api = (callback: string) =>
  `${app}/api/auth/reset-password/tok?callbackURL=${encodeURIComponent(callback)}`;
const fallback = { link: `${app}/fr/reset/tok`, locale: "fr", kind: "reset" };

describe("resetLink", () => {
  it("links to the requester's locale page", () => {
    expect(resetLink(api(`${app}/en/reset`), "tok", app)).toEqual({
      link: `${app}/en/reset/tok`,
      locale: "en",
      kind: "reset",
    });
    expect(resetLink(api("/fr/reset/"), "tok", `${app}/`)).toEqual(fallback);
  });

  it("flags the admin-provisioned setup flow", () => {
    expect(resetLink(api(`${app}/en/reset?setup=1`), "tok", app)).toEqual({
      link: `${app}/en/reset/tok`,
      locale: "en",
      kind: "setup",
    });
  });

  it("ignores foreign hosts, other same-origin paths and missing targets", () => {
    expect(resetLink(api("https://evil.example/en/reset"), "tok", app)).toEqual(fallback);
    expect(resetLink(api("//evil.example/en/reset"), "tok", app)).toEqual(fallback);
    expect(resetLink(api(`${app}/en/dashboard`), "tok", app)).toEqual(fallback);
    expect(resetLink(`${app}/api/auth/reset-password/tok`, "tok", app)).toEqual(fallback);
    expect(resetLink("not a url", "tok", app)).toEqual(fallback);
  });

  it("encodes the token", () => {
    expect(resetLink(api(`${app}/fr/reset`), "a/b?c", app).link).toBe(`${app}/fr/reset/a%2Fb%3Fc`);
  });
});
