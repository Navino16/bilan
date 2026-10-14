import { describe, it, expect } from "vitest";
import { z } from "zod";
import { failureOnField, fieldErrorsFromZod, invalidInput } from "@/lib/validation/field-errors";
import { groupInputSchema, invitationInputSchema } from "@/lib/validation/group";
import { accountInputSchema } from "@/lib/validation/account";
import { budgetInputSchema } from "@/lib/validation/budget";
import { registerSchema } from "@/server/transport/actions/auth-schemas";
import { NAME_MAX } from "@/lib/validation/name";

function errorsOf<T extends z.ZodType>(schema: T, input: Record<string, unknown>) {
  const r = schema.safeParse(input);
  if (r.success) throw new Error("expected a parse failure");
  return fieldErrorsFromZod(r.error, input);
}

describe("fieldErrorsFromZod", () => {
  it("maps string bounds to REQUIRED / TOO_LONG / TOO_SHORT", () => {
    expect(errorsOf(groupInputSchema, { name: "   ", description: "" })).toEqual({
      name: "REQUIRED",
    });
    expect(errorsOf(groupInputSchema, { name: "x".repeat(NAME_MAX + 1), description: "" })).toEqual(
      { name: "TOO_LONG" },
    );
    expect(
      errorsOf(registerSchema, {
        name: "Ada",
        email: "ada@example.com",
        password: "short",
        confirmPassword: "short",
      }),
    ).toEqual({ password: "TOO_SHORT" });
  });

  it("maps formats and keeps refinement codes on their field", () => {
    expect(errorsOf(invitationInputSchema, { email: "not-an-email", role: "MEMBER" })).toEqual({
      email: "INVALID_EMAIL",
    });
    expect(
      errorsOf(registerSchema, {
        name: "Ada",
        email: "ada@example.com",
        password: "a-long-enough-password",
        confirmPassword: "a-different-password",
      }),
    ).toEqual({ confirmPassword: "MISMATCH" });
    expect(errorsOf(z.object({ issuer: z.url() }), { issuer: "nope" })).toEqual({
      issuer: "INVALID_URL",
    });
  });

  it("reports a blank field as REQUIRED whatever the failing rule", () => {
    expect(errorsOf(invitationInputSchema, { email: "", role: "MEMBER" })).toEqual({
      email: "REQUIRED",
    });
    const custom = z.object({ issuer: z.string() }).refine((v) => v.issuer, { path: ["issuer"] });
    expect(errorsOf(custom, { issuer: "" })).toEqual({ issuer: "REQUIRED" });
  });

  it("surfaces amount codes and joins nested paths", () => {
    expect(
      errorsOf(accountInputSchema, { name: "Main", type: "CHECKING", initialBalance: "abc" }),
    ).toMatchObject({ initialBalance: "AMOUNT_INVALID" });
    const budget = errorsOf(budgetInputSchema, {
      name: "Food",
      periodType: "MONTH",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      lines: [{ plannedAmount: "10" }, { plannedAmount: "1.234" }],
    });
    expect(budget).toEqual({ "lines.1.plannedAmount": "AMOUNT_AMBIGUOUS" });
  });

  it("keeps the first issue per field and skips form-level issues", () => {
    const schema = z
      .object({ a: z.string().min(1).max(2) })
      .refine(() => false, { message: "FORM_LEVEL" });
    const r = schema.safeParse({ a: "abc" });
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrorsFromZod(r.error)).toEqual({ a: "TOO_LONG" });
  });
});

describe("failureOnField", () => {
  const fields = { BAD_PASSWORD: "currentPassword" };

  it("attaches a mapped server code to its field", () => {
    expect(failureOnField({ ok: false, error: "BAD_PASSWORD" }, fields)).toEqual({
      ok: false,
      error: "BAD_PASSWORD",
      fieldErrors: { currentPassword: "BAD_PASSWORD" },
    });
  });

  it("leaves an unmapped code as a form-level failure", () => {
    expect(failureOnField({ ok: false, error: "FAILED" }, fields)).toEqual({
      ok: false,
      error: "FAILED",
    });
  });
});

describe("invalidInput", () => {
  it("builds the action failure shape with a caller-chosen code", () => {
    const r = groupInputSchema.safeParse({ name: "", description: "" });
    expect(r.success).toBe(false);
    if (!r.success)
      expect(invalidInput(r.error, undefined, "CUSTOM")).toEqual({
        ok: false,
        error: "CUSTOM",
        fieldErrors: { name: "REQUIRED" },
      });
  });
});
