import { z } from "zod";

export const SIGNUP_TOKEN_EXPIRY_DAYS = [1, 7, 30, 90] as const;
export const SIGNUP_TOKEN_DEFAULT_EXPIRY_DAYS = 7;
export const SIGNUP_TOKEN_MAX_USES = 10_000;
export const SIGNUP_TOKEN_DESCRIPTION_MAX = 191;

export function signupTokenExpiry(days: number | null, now: Date): Date | undefined {
  return days === null ? undefined : new Date(now.getTime() + days * 86_400_000);
}

export const SIGNUP_TOKEN_MAX_USES_RANGE = { min: 1, max: SIGNUP_TOKEN_MAX_USES };

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
