import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import {
  createSignupToken,
  consumeSignupToken,
  deleteSignupToken,
  listSignupTokens,
  refundSignupToken,
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

  it("revoke() only acts once and keeps the first revocation date", async () => {
    const t = await createSignupToken({ description: "twice", createdById: adminId });
    expect(await revokeSignupToken(t.id)).toBe(true);
    const first = (await db.adminSignupToken.findUnique({ where: { id: t.id } }))?.revokedAt;
    expect(await revokeSignupToken(t.id)).toBe(false);
    expect(await revokeSignupToken("unknown-token-id")).toBe(false);
    const again = (await db.adminSignupToken.findUnique({ where: { id: t.id } }))?.revokedAt;
    expect(again).toEqual(first);
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

  it("refund() restores a consumed use so a single-use token works again", async () => {
    const t = await createSignupToken({ description: "refund", maxUses: 1, createdById: adminId });
    expect((await consumeSignupToken(t.token)).ok).toBe(true);
    expect((await consumeSignupToken(t.token)).ok).toBe(false); // exhausted
    await refundSignupToken(t.token);
    expect((await consumeSignupToken(t.token)).ok).toBe(true); // usable again
  });

  it("refund() never drives usedCount below zero", async () => {
    const t = await createSignupToken({ description: "refund0", maxUses: 3, createdById: adminId });
    await refundSignupToken(t.token); // nothing consumed yet
    const row = await db.adminSignupToken.findUnique({ where: { token: t.token } });
    expect(row?.usedCount).toBe(0);
  });

  it("list() reports each token's status", async () => {
    await db.adminSignupToken.deleteMany();
    const active = await createSignupToken({ description: "a", createdById: adminId });
    const revoked = await createSignupToken({ description: "r", createdById: adminId });
    await revokeSignupToken(revoked.id);
    const expired = await createSignupToken({
      description: "e",
      expiresAt: new Date(Date.now() - 1000),
      createdById: adminId,
    });
    const used = await createSignupToken({ description: "u", maxUses: 1, createdById: adminId });
    await consumeSignupToken(used.token);

    const byId = new Map((await listSignupTokens()).map((tk) => [tk.id, tk.status]));
    expect(byId.get(active.id)).toBe("active");
    expect(byId.get(revoked.id)).toBe("revoked");
    expect(byId.get(expired.id)).toBe("expired");
    expect(byId.get(used.id)).toBe("usedUp");
  });

  it("delete() removes unusable tokens and refuses an active one", async () => {
    const active = await createSignupToken({ description: "keep", createdById: adminId });
    expect(await deleteSignupToken(active.id)).toBe(false);
    expect(await db.adminSignupToken.count({ where: { id: active.id } })).toBe(1);

    await revokeSignupToken(active.id);
    expect(await deleteSignupToken(active.id)).toBe(true);
    const used = await createSignupToken({ description: "gone", maxUses: 1, createdById: adminId });
    await consumeSignupToken(used.token);
    expect(await deleteSignupToken(used.id)).toBe(true);
    expect(await db.adminSignupToken.count({ where: { id: { in: [active.id, used.id] } } })).toBe(
      0,
    );
  });
});
