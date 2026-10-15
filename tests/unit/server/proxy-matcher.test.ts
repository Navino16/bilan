import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/services/setup-status", () => ({ isSetupNeededCached: async () => false }));
vi.mock("@/server/services/settings/app-settings", () => ({ getAppName: async () => "Bilan" }));
vi.mock("next-intl/middleware", () => ({ default: () => () => new Response(null) }));

import { config } from "@/proxy";

const matcher = new RegExp(`^${config.matcher[0]}$`);
const proxied = (path: string) => matcher.test(path);

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}

// Metadata files Next serves from src/app (manifest.ts is served as manifest.webmanifest).
const appMetadata = readdirSync("src/app")
  .filter((f) => /^(favicon\.ico|icon\.\w+|apple-icon\.\w+|manifest\.ts)$/.test(f))
  .map((f) => (f === "manifest.ts" ? "/manifest.webmanifest" : `/${f}`));

describe("proxy matcher (#249)", () => {
  it("skips every real static file", () => {
    const statics = [...files("public").map((f) => `/${relative("public", f)}`), ...appMetadata];
    expect(statics.length).toBeGreaterThan(4);
    expect(statics.filter(proxied)).toEqual([]);
  });

  it("skips API routes and Next assets", () => {
    expect(proxied("/api/auth/get-session")).toBe(false);
    expect(proxied("/_next/static/chunks/app.js")).toBe(false);
  });

  it("runs on pages and on unknown dotted paths", () => {
    for (const path of ["/", "/fr/dashboard", "/does-not-exist.xyz", "/fr/foo.txt", "/foo"]) {
      expect(proxied(path), path).toBe(true);
    }
  });
});
