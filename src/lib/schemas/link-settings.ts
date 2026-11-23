import { z } from "zod";
import { LINK_WINDOW_DAYS_RANGE } from "@/lib/validation/link-settings";
import { amountSchema } from "./amount";

const { min, max } = LINK_WINDOW_DAYS_RANGE;

export const linkSettingsSchema = z.object({
  windowDays: z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === "number" ? v : v.trim() === "" ? NaN : Number(v)))
    .refine((n) => Number.isInteger(n) && n >= min && n <= max, { error: "OUT_OF_RANGE" }),
  minAmount: amountSchema.refine((n) => n >= 0, { error: "TOO_SMALL" }),
});

export type LinkSettingsInput = z.input<typeof linkSettingsSchema>;
export type LinkSettings = z.output<typeof linkSettingsSchema>;
