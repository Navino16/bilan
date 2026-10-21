import { z } from "zod";
import { MERCHANT_NAME_MAX } from "@/lib/validation/merchant";

export const merchantNameSchema = z
  .string()
  .transform((s) => s.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1).max(MERCHANT_NAME_MAX));

// Same casing/accents as merchantKey(), which can't be re-applied (it strips prefixes).
export const merchantKeySchema = z
  .string()
  .transform((k) =>
    k
      .replace(/\s+/g, " ")
      .trim()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toUpperCase(),
  )
  .pipe(z.string().min(1).max(200));
