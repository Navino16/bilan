import { z } from "zod";
import { EXCEPTIONAL_FACTOR_RANGE } from "@/lib/exceptional";
import { amountSchema } from "./amount";

const { min, max } = EXCEPTIONAL_FACTOR_RANGE;
const tenths = (n: number) => Math.abs(n * 10 - Math.round(n * 10)) < 1e-9;

export const exceptionalSettingsSchema = z.object({
  minAmount: amountSchema.refine((n) => n >= 0, { error: "TOO_SMALL" }),
  factor: z
    .union([z.string(), z.number()])
    .transform((v) =>
      typeof v === "number" ? v : v.trim() === "" ? NaN : Number(v.trim().replace(",", ".")),
    )
    .refine((n) => Number.isFinite(n) && n >= min && n <= max && tenths(n), {
      error: "FACTOR_RANGE",
    }),
});

export type ExceptionalSettingsInput = z.input<typeof exceptionalSettingsSchema>;
