import { describe, it, expect } from "vitest";
import { readTheme, themeCookie } from "@/lib/theme";

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

describe("themeCookie (#255)", () => {
  it("stores an explicit choice for a year", () => {
    expect(themeCookie("dark")).toBe("bilan-theme=dark; path=/; max-age=31536000; samesite=lax");
    expect(themeCookie("light")).toBe("bilan-theme=light; path=/; max-age=31536000; samesite=lax");
  });

  it("clears the override for the system theme", () => {
    expect(themeCookie("system")).toBe("bilan-theme=; path=/; max-age=0; samesite=lax");
  });
});
