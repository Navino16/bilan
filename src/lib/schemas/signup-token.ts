import { z } from "zod";
import {
  SIGNUP_TOKEN_DESCRIPTION_MAX,
  SIGNUP_TOKEN_EXPIRY_DAYS,
  SIGNUP_TOKEN_MAX_USES_RANGE,
} from "@/lib/validation/signup-token";

const optionalInt = ({ min, max }: { min: number; max: number }) =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .refine((n) => n === null || (Number.isInteger(n) && n >= min && n <= max), {
      error: "OUT_OF_RANGE",
    });

export const createSignupTokenSchema = z.object({
  description: z
    .string()
    .trim()
    .max(SIGNUP_TOKEN_DESCRIPTION_MAX)
    .transform((v) => v || undefined),
  maxUses: optionalInt(SIGNUP_TOKEN_MAX_USES_RANGE),
  expiresInDays: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .refine((v) => v === null || (SIGNUP_TOKEN_EXPIRY_DAYS as readonly number[]).includes(v)),
});
