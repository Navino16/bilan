import { z } from "zod";
import { readAmount } from "@/lib/amount";

// Money input (number or typed string), rounded to cents. Failures carry an
// AmountError code as their message, for `issueCode` to surface.
export const amountSchema = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const r = readAmount(v);
  if (r.ok) return Math.round(r.value * 100) / 100;
  ctx.addIssue({ code: "custom", message: r.error });
  return z.NEVER;
});

// The first issue's message when it is one of `known` codes, else "INVALID".
export function issueCode(issues: { message: string }[], known: readonly string[]): string {
  const code = issues[0]?.message ?? "";
  return known.includes(code) ? code : "INVALID";
}
