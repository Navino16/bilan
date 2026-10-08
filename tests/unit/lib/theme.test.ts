import { describe, it, expect } from "vitest";
import { readTheme } from "@/lib/theme";

describe("readTheme", () => {
  it("honours an explicit choice", () => {
    expect(readTheme("dark")).toBe("dark");
    expect(readTheme("light")).toBe("light");
  });

  it("follows the OS without a valid cookie", () => {
    expect(readTheme(undefined)).toBe("system");
    expect(readTheme("blue")).toBe("system");
  });
});
