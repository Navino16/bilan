import { z } from "zod";
import {
  ACCOUNT_BANK_NAME_MAX,
  ACCOUNT_IBAN_MAX,
  ACCOUNT_NAME_MAX,
  ACCOUNT_TYPES,
} from "@/lib/validation/account";
import { amountSchema } from "./amount";

// `iban` is validated for *format* here; mod-97 validity is enforced in the
// service (which can return a typed error). Empty string === "no IBAN".
export const accountInputSchema = z.object({
  name: z.string().trim().min(1).max(ACCOUNT_NAME_MAX),
  type: z.enum(ACCOUNT_TYPES),
  iban: z
    .string()
    .trim()
    .max(ACCOUNT_IBAN_MAX)
    .optional()
    .transform((v) => (v ? v : undefined)),
  bankName: z
    .string()
    .trim()
    .max(ACCOUNT_BANK_NAME_MAX)
    .optional()
    .transform((v) => (v ? v : undefined)),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  icon: z.string().trim().max(50).optional(),
  // Opening balance in clear (Decimal(12,2)). Accepts a number or a string with
  // a comma or dot decimal separator; empty === 0. Negative allowed (credit).
  initialBalance: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined || v === "" ? 0 : v))
    .pipe(amountSchema),
});

// Use the *input* type: `iban`/`bankName` are optional keys callers may omit;
// the schema's transforms normalise empty strings to `undefined` on parse.
export type AccountInput = z.input<typeof accountInputSchema>;
