import { describe, it, expect } from "vitest";
import {
  loginSchema,
  registerSchema,
  resetRequestSchema,
  resetConfirmSchema,
  changePasswordSchema,
} from "@/server/transport/actions/auth-schemas";

describe("auth schemas", () => {
  it("rejects an invalid email on login", () => {
    expect(loginSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
  });
  it("requires a password of at least 12 chars on register", () => {
    const password = "x".repeat(12);
    expect(
      registerSchema.safeParse({ email: "a@b.co", password, confirmPassword: password, name: "A" })
        .success,
    ).toBe(true);
    expect(
      registerSchema.safeParse({
        email: "a@b.co",
        password: "short",
        confirmPassword: "short",
        name: "Ann",
      }).success,
    ).toBe(false);
  });
  it("flags a password confirmation mismatch on register (#172)", () => {
    const r = registerSchema.safeParse({
      email: "a@b.co",
      password: "x".repeat(12),
      confirmPassword: "y".repeat(12),
      name: "Ann",
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("MISMATCH");
    expect(
      registerSchema.safeParse({ email: "a@b.co", password: "x".repeat(12), name: "Ann" }).success,
    ).toBe(false);
  });
  it("accepts a token on reset confirm", () => {
    const r = resetConfirmSchema.safeParse({
      token: "11111111-1111-4111-8111-111111111111",
      password: "x".repeat(12),
    });
    expect(r.success).toBe(true);
  });
  it("rejects when reset email is missing on reset request", () => {
    expect(resetRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("change password schema", () => {
  const base = {
    currentPassword: "old-password-123",
    newPassword: "new-password-1234",
    confirmPassword: "new-password-1234",
    revokeOtherSessions: "true",
  };
  it("parses the revoke flag", () => {
    const r = changePasswordSchema.safeParse({ ...base, revokeOtherSessions: "false" });
    expect(r.success && r.data.revokeOtherSessions).toBe(false);
  });
  it("flags a confirmation mismatch", () => {
    const r = changePasswordSchema.safeParse({ ...base, confirmPassword: "something-else" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("MISMATCH");
  });
});
