import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { AUTHED_SEGMENTS, authedPathLocale } from "@/lib/authed-paths";

describe("authed paths", () => {
  it("lists exactly the (authenticated) route segments", () => {
    const dir = join(process.cwd(), "src/app/[locale]/(authenticated)");
    const segments = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect([...AUTHED_SEGMENTS].sort()).toEqual(segments);
  });

  it("matches a segment and its children under a locale", () => {
    expect(authedPathLocale("/fr/insights")).toBe("fr");
    expect(authedPathLocale("/en/admin/users")).toBe("en");
    expect(authedPathLocale("/fr/insightsx")).toBeNull();
    expect(authedPathLocale("/fr/login")).toBeNull();
    expect(authedPathLocale("/de/dashboard")).toBeNull();
  });
});
