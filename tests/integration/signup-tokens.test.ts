import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import {
  createSignupToken,
  consumeSignupToken,
  revokeSignupToken,
} from "@/server/services/signup-tokens";

const adminId = "admin_tokens";

beforeAll(async () => {
  await db.adminSignupToken.deleteMany();
  await db.user.deleteMany({ where: { id: adminId } });
  await db.user.create({ data: { id: adminId, email: `at+${Date.now()}@bilan.local` } });
});

afterAll(async () => {
  await db.adminSignupToken.deleteMany();
  await db.user.deleteMany({ where: { id: adminId } });
  await db.$disconnect();
});

describe("signup tokens", () => {
  it("creates a usable token", async () => {
    const t = await createSignupToken({ description: "test", maxUses: 2, createdById: adminId });
    expect(t.token).toMatch(/^[A-Za-z0-9_-]{16,}$/);
  });

  it("consume() returns ok within max-uses, then false", async () => {
    const t = await createSignupToken({ description: "u1", maxUses: 1, createdById: adminId });
    expect((await consumeSignupToken(t.token)).ok).toBe(true);
    expect((await consumeSignupToken(t.token)).ok).toBe(false);
  });

  it("consume() returns false when revoked", async () => {
    const t = await createSignupToken({ description: "r", maxUses: 5, createdById: adminId });
    await revokeSignupToken(t.id);
    expect((await consumeSignupToken(t.token)).ok).toBe(false);
  });

  it("consume() returns false when expired", async () => {
    const t = await createSignupToken({
      description: "x",
      maxUses: 5,
      expiresAt: new Date(Date.now() - 1000),
      createdById: adminId,
    });
    expect((await consumeSignupToken(t.token)).ok).toBe(false);
  });

  it("consume() returns false for an unknown token", async () => {
    expect((await consumeSignupToken("does-not-exist")).ok).toBe(false);
  });
});
