import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const setup = vi.hoisted(() => ({ needed: false }));
vi.mock("@/server/services/setup-status", () => ({
  isSetupNeededCached: async () => setup.needed,
}));
// next-intl's ESM build imports "next/server" extensionless, which Node can't resolve here;
// these cases return before the locale middleware runs.
vi.mock("next-intl/middleware", () => ({ default: () => () => new Response(null) }));

import middleware from "@/proxy";

const request = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(new URL(path, "http://localhost:3214"), { headers });

describe("proxy setup gate (#214)", () => {
  it("redirects to the setup page in the visitor's locale until a user exists", async () => {
    setup.needed = true;
    const fromPath = await middleware(request("/en/dashboard", { "accept-language": "fr" }));
    expect(fromPath.status).toBe(307);
    expect(new URL(fromPath.headers.get("location")!).pathname).toBe("/en/setup");

    const fromBrowser = await middleware(request("/", { "accept-language": "en-US,en;q=0.9" }));
    expect(new URL(fromBrowser.headers.get("location")!).pathname).toBe("/en/setup");

    const fallback = await middleware(request("/"));
    expect(new URL(fallback.headers.get("location")!).pathname).toBe("/fr/setup");
  });

  it("serves the localized setup 404 with the security headers once setup is done", async () => {
    setup.needed = false;
    const res = await middleware(request("/en/setup"));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-language")).toBe("en");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("proxy CSP upgrade-insecure-requests", () => {
  const cspFor = async (appUrl: string) => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", appUrl);
    const { default: proxy } = await import("@/proxy");
    setup.needed = false;
    const res = await proxy(request("/en/setup"));
    vi.unstubAllEnvs();
    return res.headers.get("content-security-policy") ?? "";
  };

  it("upgrades subresources only when the app is served over HTTPS", async () => {
    expect(await cspFor("https://bilan.example")).toContain("upgrade-insecure-requests");
    expect(await cspFor("http://192.168.1.10:3000")).not.toContain("upgrade-insecure-requests");
  });
});
