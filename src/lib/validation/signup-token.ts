import { z } from "zod";

export const SIGNUP_TOKEN_EXPIRY_DAYS = [1, 7, 30, 90] as const;
export const SIGNUP_TOKEN_DEFAULT_EXPIRY_DAYS = 7;
export const SIGNUP_TOKEN_MAX_USES = 10_000;

export function signupTokenExpiry(days: number | null, now: Date): Date | undefined {
  return days === null ? undefined : new Date(now.getTime() + days * 86_400_000);
}

const optionalInt = (max: number) =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .pipe(z.number().int().min(1).max(max).nullable());

export const createSignupTokenSchema = z.object({
  description: z
    .string()
    .trim()
    .max(191)
    .transform((v) => v || undefined),
  maxUses: optionalInt(SIGNUP_TOKEN_MAX_USES),
  expiresInDays: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .refine((v) => v === null || (SIGNUP_TOKEN_EXPIRY_DAYS as readonly number[]).includes(v)),
});
