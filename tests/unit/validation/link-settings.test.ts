import { describe, it, expect } from "vitest";
import { linkSettingsSchema } from "@/lib/validation/link-settings";
import { fieldErrorsFromZod } from "@/lib/validation/field-errors";

const parse = (input: { windowDays?: string | number; minAmount?: string | number }) =>
  linkSettingsSchema.safeParse({ windowDays: "30", minAmount: "0", ...input });

describe("linkSettingsSchema", () => {
  it("reads a whole number of days and a money amount", () => {
    const r = parse({ windowDays: " 7 ", minAmount: "1 234,5" });
    expect(r.success && r.data).toEqual({ windowDays: 7, minAmount: 1234.5 });
  });

  it("accepts the bounds: same-day only, a year, and no minimum", () => {
    expect(parse({ windowDays: "0", minAmount: "0" }).success).toBe(true);
    expect(parse({ windowDays: 365 }).success).toBe(true);
  });

  it("rejects a window outside 0–365 days or not whole", () => {
    for (const windowDays of ["-1", "366", "2.5", "abc"]) {
      const r = parse({ windowDays });
      expect(r.success).toBe(false);
      if (!r.success) expect(fieldErrorsFromZod(r.error)).toEqual({ windowDays: "OUT_OF_RANGE" });
    }
  });

  it("reports blank fields as required", () => {
    const input = { windowDays: "", minAmount: " " };
    const r = linkSettingsSchema.safeParse(input);
    expect(r.success).toBe(false);
    if (!r.success)
      expect(fieldErrorsFromZod(r.error, input)).toEqual({
        windowDays: "REQUIRED",
        minAmount: "REQUIRED",
      });
  });

  it("rejects a negative minimum or a fraction of a cent", () => {
    const negative = parse({ minAmount: "-5" });
    expect(!negative.success && fieldErrorsFromZod(negative.error)).toEqual({
      minAmount: "TOO_SMALL",
    });
    const precise = parse({ minAmount: "1,234" });
    expect(precise.success).toBe(false);
  });
});
