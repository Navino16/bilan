import { describe, it, expect } from "vitest";
import { APP_NAME_MAX, appNameSchema } from "@/lib/validation/app-name";

describe("appNameSchema (#224)", () => {
  it("trims and accepts names up to the maximum length", () => {
    expect(appNameSchema.parse("  Maison  ")).toBe("Maison");
    expect(appNameSchema.parse(` ${"a".repeat(APP_NAME_MAX)} `)).toBe("a".repeat(APP_NAME_MAX));
  });

  it("rejects blank names and names over the maximum length", () => {
    expect(APP_NAME_MAX).toBe(40);
    expect(appNameSchema.safeParse("   ").success).toBe(false);
    expect(appNameSchema.safeParse("a".repeat(APP_NAME_MAX + 1)).success).toBe(false);
  });
});
