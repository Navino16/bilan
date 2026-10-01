import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const filters = readFileSync(".github/workflows/prod-smoke.yml", "utf8")
  .split("\n")
  .map((l) => l.match(/^\s+- "?([^"]+)"?$/)?.[1])
  .filter((p): p is string => Boolean(p));

const covered = (file: string) =>
  filters.some((f) => f === file || (f.endsWith("/**") && file.startsWith(f.slice(0, -2))));

// Every build-context file the image copies explicitly, plus the config the standalone build needs.
const copied = readFileSync("Dockerfile", "utf8")
  .split("\n")
  .filter((l) => /^COPY /.test(l) && !l.includes("--from="))
  .flatMap((l) =>
    l
      .replace(/^COPY (--\S+ )*/, "")
      .split(/\s+/)
      .slice(0, -1),
  )
  .filter((src) => src !== ".");

describe("prod smoke workflow path filters", () => {
  it.each([...new Set([...copied, "next.config.ts"])])("triggers on %s", (file) => {
    expect(covered(file)).toBe(true);
  });
});
