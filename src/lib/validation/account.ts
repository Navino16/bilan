import { z } from "zod";

export const ACCOUNT_TYPES = ["CHECKING", "SAVINGS", "CREDIT", "OTHER"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

// `iban` is validated for *format* here; mod-97 validity is enforced in the
// service (which can return a typed error). Empty string === "no IBAN".
export const accountInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(ACCOUNT_TYPES),
  iban: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v ? v : undefined)),
  bankName: z
    .string()
    .trim()
    .max(100)
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
    .transform((v) => {
      if (v === undefined || v === "") return 0;
      const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
      return Math.round(n * 100) / 100;
    })
    .refine((n) => Number.isFinite(n) && Math.abs(n) < 1e10, {
      message: "Invalid balance",
    }),
});

// Use the *input* type: `iban`/`bankName` are optional keys callers may omit;
// the schema's transforms normalise empty strings to `undefined` on parse.
export type AccountInput = z.input<typeof accountInputSchema>;
