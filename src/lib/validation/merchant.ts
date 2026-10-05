import { z } from "zod";

export const MERCHANT_NAME_MAX = 60;

export const merchantNameSchema = z
  .string()
  .transform((s) => s.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1).max(MERCHANT_NAME_MAX));

// Same casing/accents as merchantKey(), which can't be re-applied (it strips prefixes).
export const merchantKeySchema = z
  .string()
  .transform((k) =>
    k
      .trim()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toUpperCase(),
  )
  .pipe(z.string().min(1).max(200));
