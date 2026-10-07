import { describe, it, expect } from "vitest";
import { uniqueName } from "@/lib/unique-name";

describe("uniqueName", () => {
  it("keeps a free name as is", () => {
    expect(uniqueName("Chrome · Linux", [])).toBe("Chrome · Linux");
    expect(uniqueName("Chrome · Linux", ["Safari · iPhone", null])).toBe("Chrome · Linux");
  });

  it("suffixes the first free number when the name is taken", () => {
    expect(uniqueName("Chrome · Linux", ["Chrome · Linux"])).toBe("Chrome · Linux (2)");
    expect(uniqueName("Chrome · Linux", ["Chrome · Linux", "Chrome · Linux (2)"])).toBe(
      "Chrome · Linux (3)",
    );
    expect(uniqueName("Chrome · Linux", ["Chrome · Linux", "Chrome · Linux (3)"])).toBe(
      "Chrome · Linux (2)",
    );
  });

  it("compares names case-insensitively, ignoring surrounding spaces", () => {
    expect(uniqueName("Chrome · Linux", [" chrome · linux "])).toBe("Chrome · Linux (2)");
  });
});
