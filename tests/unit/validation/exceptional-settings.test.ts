import { describe, it, expect } from "vitest";
import { exceptionalSettingsSchema } from "@/lib/schemas/exceptional-settings";
import { fieldErrorsFromZod } from "@/lib/validation/field-errors";

const parse = (input: { minAmount?: string | number; factor?: string | number }) =>
  exceptionalSettingsSchema.safeParse({ minAmount: "50", factor: "2", ...input });

describe("exceptionalSettingsSchema", () => {
  it("reads a money amount and a multiple with one decimal, comma or dot", () => {
    const r = parse({ minAmount: "1 234,5", factor: " 1,5 " });
    expect(r.success && r.data).toEqual({ minAmount: 1234.5, factor: 1.5 });
    expect(parse({ factor: "2.5" }).success).toBe(true);
  });

  it("accepts the bounds: no minimum, the average itself and ten times it", () => {
    expect(parse({ minAmount: "0", factor: "1" }).success).toBe(true);
    expect(parse({ factor: 10 }).success).toBe(true);
  });

  it("rejects a multiple outside 1–10 or with more than one decimal", () => {
    for (const factor of ["0.9", "10.5", "1.25", "abc", "-2"]) {
      const r = parse({ factor });
      expect(r.success).toBe(false);
      if (!r.success) expect(fieldErrorsFromZod(r.error)).toEqual({ factor: "FACTOR_RANGE" });
    }
  });

  it("rejects a negative minimum", () => {
    const r = parse({ minAmount: "-5" });
    expect(!r.success && fieldErrorsFromZod(r.error)).toEqual({ minAmount: "TOO_SMALL" });
  });
});
