import { describe, it, expect } from "vitest";
import { loginRedirectPath, pathLocale, postLoginPath, safeCallbackPath } from "@/lib/callback-url";

describe("safeCallbackPath", () => {
  it("keeps a same-origin path with its query and hash", () => {
    expect(safeCallbackPath("/fr/transactions?month=2026-09&q=café#top")).toBe(
      "/fr/transactions?month=2026-09&q=caf%C3%A9#top",
    );
    expect(safeCallbackPath("/en/dashboard")).toBe("/en/dashboard");
  });

  it("normalises dot segments without leaving the origin", () => {
    expect(safeCallbackPath("/fr/../../en/accounts")).toBe("/en/accounts");
  });

  it.each([
    ["absolute http URL", "https://evil.example/fr/dashboard"],
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/html,hi"],
    ["protocol-relative", "//evil.example"],
    ["protocol-relative with path", "//evil.example/fr/dashboard"],
    ["backslash host", "/\\evil.example"],
    ["double backslash", "\\\\evil.example"],
    ["backslash later in the path", "/fr\\..\\..\\evil"],
    ["tab-smuggled slashes", "/\t/evil.example"],
    ["newline-smuggled slashes", "/\n/evil.example"],
    ["leading whitespace", " /fr/dashboard"],
    ["relative path", "fr/dashboard"],
    ["empty", ""],
    ["bare slash", "/"],
    ["dot-dot to protocol-relative", "/..//evil.example"],
    ["dot to protocol-relative", "/.//evil.example"],
    ["encoded dot-dot to protocol-relative", "/%2e%2e//evil.example"],
    ["nested dot-dot to protocol-relative", "/fr/../..//evil"],
    ["API route", "/api/auth/sign-out"],
    ["Next internals", "/_next/static/chunks/app.js"],
    ["unprefixed app path", "/dashboard"],
    ["unknown locale", "/de/dashboard"],
    ["locale-like prefix", "/frx/dashboard"],
    ["oversized", `/fr/${"a".repeat(2100)}`],
  ])("rejects %s", (_label, raw) => {
    expect(safeCallbackPath(raw)).toBeNull();
  });

  it("rejects non-string input", () => {
    expect(safeCallbackPath(undefined)).toBeNull();
    expect(safeCallbackPath(null)).toBeNull();
    expect(safeCallbackPath(["/fr/dashboard"])).toBeNull();
  });

  it("rejects the auth pages so a login never loops back to itself", () => {
    expect(safeCallbackPath("/fr/login")).toBeNull();
    expect(safeCallbackPath("/en/login?callbackUrl=/en/dashboard")).toBeNull();
    expect(safeCallbackPath("/fr/register")).toBeNull();
    expect(safeCallbackPath("/fr/reset/abc")).toBeNull();
    expect(safeCallbackPath("/fr/setup")).toBeNull();
    expect(safeCallbackPath("/fr/loginx")).toBe("/fr/loginx");
  });

  it("keeps percent-encoded slashes inside a locale path (same origin)", () => {
    expect(safeCallbackPath("/fr/%2F%2Fevil.example")).toBe("/fr/%2F%2Fevil.example");
  });

  it("accepts a bare locale root", () => {
    expect(safeCallbackPath("/en")).toBe("/en");
    expect(safeCallbackPath("/fr?x=1")).toBe("/fr?x=1");
  });

  it("exposes the locale of an accepted path", () => {
    expect(pathLocale("/en/accounts?x=1")).toBe("en");
    expect(pathLocale("/fr")).toBe("fr");
  });
});

describe("postLoginPath", () => {
  it("falls back to the localized dashboard", () => {
    expect(postLoginPath(undefined, "fr")).toBe("/fr/dashboard");
    expect(postLoginPath("//evil.example", "en")).toBe("/en/dashboard");
  });

  it("returns a safe callback as-is", () => {
    expect(postLoginPath("/fr/budgets/abc", "fr")).toBe("/fr/budgets/abc");
  });
});

describe("loginRedirectPath", () => {
  it("carries the requested path and query as callbackUrl", () => {
    expect(loginRedirectPath("fr", "/fr/transactions?month=2026-09")).toBe(
      "/fr/login?callbackUrl=%2Ffr%2Ftransactions%3Fmonth%3D2026-09",
    );
  });

  it("omits the callback for the default landing page", () => {
    expect(loginRedirectPath("en", "/en/dashboard")).toBe("/en/login");
  });

  it("drops an unsafe target", () => {
    expect(loginRedirectPath("fr", "/api/secret")).toBe("/fr/login");
    expect(loginRedirectPath("fr", null)).toBe("/fr/login");
  });

  it("round-trips through safeCallbackPath", () => {
    const login = new URL(loginRedirectPath("fr", "/fr/accounts?a=1&b=2"), "http://x");
    expect(safeCallbackPath(login.searchParams.get("callbackUrl"))).toBe("/fr/accounts?a=1&b=2");
  });
});
