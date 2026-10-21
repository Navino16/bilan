import { describe, it, expect } from "vitest";
import { signupTokenExpiry } from "@/lib/validation/signup-token";
import { createSignupTokenSchema } from "@/lib/schemas/signup-token";
import { fieldErrorsFromZod } from "@/lib/validation/field-errors";

describe("signupTokenExpiry", () => {
  it("adds whole days, or never expires", () => {
    const now = new Date("2026-10-07T12:00:00.000Z");
    expect(signupTokenExpiry(7, now)?.toISOString()).toBe("2026-10-14T12:00:00.000Z");
    expect(signupTokenExpiry(null, now)).toBeUndefined();
  });
});

const parse = (input: Partial<Record<"description" | "maxUses" | "expiresInDays", string>>) =>
  createSignupTokenSchema.safeParse({ description: "", maxUses: "", expiresInDays: "", ...input });

describe("createSignupTokenSchema", () => {
  it("treats empty fields as unlimited, never-expiring and undescribed", () => {
    const r = parse({});
    expect(r.success && r.data).toEqual({
      description: undefined,
      maxUses: null,
      expiresInDays: null,
    });
  });

  it("accepts a bounded max-uses and a listed expiry", () => {
    const r = parse({ description: " team ", maxUses: "3", expiresInDays: "30" });
    expect(r.success && r.data).toEqual({ description: "team", maxUses: 3, expiresInDays: 30 });
  });

  it("rejects out-of-range or non-integer max-uses (#164: 99999999999 used to 500)", () => {
    for (const maxUses of ["0", "1.5", "abc", "99999999999", "10001"]) {
      const r = parse({ maxUses });
      expect(r.success, maxUses).toBe(false);
      // One range message on the field (#227), not TOO_SMALL / INVALID depending on the input.
      if (!r.success) expect(fieldErrorsFromZod(r.error)).toEqual({ maxUses: "OUT_OF_RANGE" });
    }
  });

  it("rejects an expiry that isn't offered", () => {
    expect(parse({ expiresInDays: "2" }).success).toBe(false);
    expect(parse({ expiresInDays: "-1" }).success).toBe(false);
  });
});
