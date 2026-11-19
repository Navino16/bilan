import { describe, it, expect } from "vitest";
import { passwordStepOutcome } from "@/components/auth/oauth-consent-outcome";

describe("passwordStepOutcome", () => {
  it("leaves for the client once granted", () => {
    expect(passwordStepOutcome({ ok: true, url: "http://127.0.0.1/cb?code=x" })).toEqual({
      next: "leave",
      url: "http://127.0.0.1/cb?code=x",
    });
  });

  it("keeps the password dialog open on a step-up failure", () => {
    const failure = { ok: false, error: "BAD_PASSWORD" } as const;
    expect(passwordStepOutcome(failure)).toEqual({ next: "retry", failure });
  });

  it("switches to signing in again when the client asked for a fresh login", () => {
    expect(passwordStepOutcome({ ok: false, error: "LOGIN_REQUIRED" })).toEqual({
      next: "signIn",
    });
  });

  it("hands any other error to the page", () => {
    expect(passwordStepOutcome({ ok: false, error: "INSTANCE_DISABLED" })).toEqual({
      next: "fail",
      error: "INSTANCE_DISABLED",
    });
  });
});
