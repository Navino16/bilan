import type { z } from "zod";

// Field name (zod path joined with ".") → error code, translated under `forms.fieldError`.
export type FieldErrors = Record<string, string>;

export type FormFailure = { ok: false; error: string; fieldErrors?: FieldErrors };

const ERROR_CODE = /^[A-Z][A-Z0-9_]*$/;

type Issue = z.ZodError["issues"][number];

function issueCode(issue: Issue): string {
  switch (issue.code) {
    case "too_big":
      return issue.origin === "string" ? "TOO_LONG" : "TOO_BIG";
    case "too_small":
      if (issue.origin === "string") return Number(issue.minimum) <= 1 ? "REQUIRED" : "TOO_SHORT";
      return issue.origin === "array" ? "REQUIRED" : "TOO_SMALL";
    case "invalid_format":
      if (issue.format === "email") return "INVALID_EMAIL";
      if (issue.format === "url") return "INVALID_URL";
      return "INVALID_FORMAT";
    case "custom":
      // Refinements carry their own code as message (e.g. "MISMATCH", "AMOUNT_INVALID").
      return ERROR_CODE.test(issue.message) ? issue.message : "INVALID";
    default:
      return "INVALID";
  }
}

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

// First issue per field wins. Passing the raw input reports any issue on a blank top-level field as REQUIRED.
export function fieldErrorsFromZod(
  error: z.ZodError,
  input?: Record<string, unknown>,
): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    if (issue.path.length === 0) continue;
    const key = issue.path.map(String).join(".");
    if (key in out) continue;
    const blank = input !== undefined && issue.path.length === 1 && isBlank(input[key]);
    out[key] = blank ? "REQUIRED" : issueCode(issue);
  }
  return out;
}

// Puts a server error code on its field (code → field name) instead of the form alert.
export function failureOnField<F extends { ok: false; error: string }>(
  failure: F,
  fieldsByCode: Partial<Record<string, string>>,
): F & { fieldErrors?: FieldErrors } {
  const field = fieldsByCode[failure.error];
  return field ? { ...failure, fieldErrors: { [field]: failure.error } } : failure;
}

export function invalidInput(
  error: z.ZodError,
  input?: Record<string, unknown>,
  code = "INVALID",
): FormFailure {
  return { ok: false, error: code, fieldErrors: fieldErrorsFromZod(error, input) };
}
