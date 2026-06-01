import { describe, it, expect } from "vitest";
import {
  loginSchema,
  registerSchema,
  resetRequestSchema,
  resetConfirmSchema,
} from "@/server/transport/actions/auth-schemas";

describe("auth schemas", () => {
  it("rejects an invalid email on login", () => {
    expect(loginSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
  });
  it("requires a password of at least 12 chars on register", () => {
    expect(
      registerSchema.safeParse({ email: "a@b.co", password: "x".repeat(12), name: "Ann" }).success,
    ).toBe(true);
    expect(
      registerSchema.safeParse({ email: "a@b.co", password: "short", name: "Ann" }).success,
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
