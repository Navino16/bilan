import { randomBytes } from "node:crypto";
import type { AdminSignupToken } from "@prisma/client";
import { db } from "@/server/db";

export async function createSignupToken(input: {
  description?: string;
  maxUses?: number | null;
  expiresAt?: Date;
  createdById: string;
}): Promise<{ id: string; token: string }> {
  const token = randomBytes(24).toString("base64url");
  const row = await db.adminSignupToken.create({
    data: {
      token,
      description: input.description ?? null,
      maxUses: input.maxUses ?? null,
      expiresAt: input.expiresAt ?? null,
      createdById: input.createdById,
    },
  });
  return { id: row.id, token };
}

export async function consumeSignupToken(token: string): Promise<{ ok: boolean }> {
  // Single conditional update so the validity checks and the usedCount increment
  // are atomic — avoids a TOCTOU race where concurrent requests over-consume a
  // token (e.g. both passing a maxUses=1 check before either increments).
  const { count } = await db.adminSignupToken.updateMany({
    where: {
      token,
      revokedAt: null,
      AND: [
        { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        { OR: [{ maxUses: null }, { usedCount: { lt: db.adminSignupToken.fields.maxUses } }] },
      ],
    },
    data: { usedCount: { increment: 1 } },
  });
  return { ok: count === 1 };
}

export async function revokeSignupToken(id: string): Promise<void> {
  await db.adminSignupToken.update({ where: { id }, data: { revokedAt: new Date() } });
}

export function listSignupTokens(): Promise<AdminSignupToken[]> {
  return db.adminSignupToken.findMany({ orderBy: { createdAt: "desc" } });
}
