export const SIGNUP_TOKEN_EXPIRY_DAYS = [1, 7, 30, 90] as const;
export const SIGNUP_TOKEN_DEFAULT_EXPIRY_DAYS = 7;
const SIGNUP_TOKEN_MAX_USES = 10_000;
export const SIGNUP_TOKEN_DESCRIPTION_MAX = 191;

export function signupTokenExpiry(days: number | null, now: Date): Date | undefined {
  return days === null ? undefined : new Date(now.getTime() + days * 86_400_000);
}

export const SIGNUP_TOKEN_MAX_USES_RANGE = { min: 1, max: SIGNUP_TOKEN_MAX_USES };
