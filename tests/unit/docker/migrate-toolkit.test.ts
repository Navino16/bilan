import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));

describe("prod migrate toolkit (docker/migrate)", () => {
  it("pins the same versions as the app lockfile", () => {
    const appLock = json("package-lock.json").packages;
    const deps: Record<string, string> = json("docker/migrate/package.json").dependencies;
    expect(Object.keys(deps).sort()).toEqual(["dotenv", "prisma"]);
    for (const [name, version] of Object.entries(deps)) {
      expect(version, name).toBe(appLock[`node_modules/${name}`].version);
    }
  });

  it("ships a lockfile matching its package.json", () => {
    expect(existsSync("docker/migrate/package-lock.json")).toBe(true);
    const lockRoot = json("docker/migrate/package-lock.json").packages[""];
    expect(lockRoot.dependencies).toEqual(json("docker/migrate/package.json").dependencies);
  });
});
