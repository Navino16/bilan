import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { hmacExact } from "@/server/crypto/hmac";
import { searchKey } from "@/server/crypto/keys";
import { logEvent } from "@/server/services/audit";
import { fieldErrorsFromZod } from "@/lib/validation/field-errors";
import { PreferenceInputError, getMcpEnabled } from "@/server/services/users/preferences";
import { isMcpInstanceEnabled } from "./switches";
import type { McpPrincipal } from "./context";

export const MCP_TOKEN_PREFIX = "bilan_pat_";
const VISIBLE_PREFIX_LENGTH = 16;
const LAST_USED_GRANULARITY_MS = 60_000;

const tokenHash = (token: string) => hmacExact(token, searchKey);

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scope: z.enum(["read", "write"], { error: "INVALID" }),
  expiresAt: z
    .date()
    .refine((d) => d.getTime() > Date.now(), { error: "PAST" })
    .nullish(),
});

export async function createMcpToken(
  userId: string,
  input: { name: string; scope: "read" | "write"; expiresAt?: Date | null },
): Promise<{ id: string; token: string; prefix: string }> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) throw new PreferenceInputError(fieldErrorsFromZod(parsed.error, input));
  const { name, scope, expiresAt } = parsed.data;
  const token = MCP_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const prefix = token.slice(0, VISIBLE_PREFIX_LENGTH);
  const row = await db.mcpToken.create({
    data: {
      userId,
      name,
      scope,
      prefix,
      tokenHash: tokenHash(token),
      expiresAt: expiresAt ?? null,
    },
    select: { id: true },
  });
  await logEvent({
    userId,
    action: "mcp.token.created",
    entity: "McpToken",
    entityId: row.id,
    metadata: { name, scope },
  });
  return { id: row.id, token, prefix };
}

export function listMcpTokens(userId: string) {
  return db.mcpToken.findMany({
    where: { userId, revokedAt: null },
    select: {
      id: true,
      name: true,
      prefix: true,
      scope: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function revokeMcpToken(userId: string, id: string): Promise<void> {
  const { count } = await db.mcpToken.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 0) throw new Error("NOT_FOUND");
  await logEvent({ userId, action: "mcp.token.revoked", entity: "McpToken", entityId: id });
}

export async function revokeAllMcpTokens(
  userId: string,
  reason: "password" | "sessions",
): Promise<number> {
  const { count } = await db.mcpToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await logEvent({
    userId,
    action: "mcp.token.revoked_all",
    entity: "McpToken",
    metadata: { reason, count },
  });
  return count;
}

export async function principalFromToken(token: string): Promise<McpPrincipal | null> {
  if (!token.startsWith(MCP_TOKEN_PREFIX)) return null;
  const now = new Date();
  const row = await db.mcpToken.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: { user: { select: { banned: true } } },
  });
  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt <= now) || row.user.banned) {
    return null;
  }
  if (!(await isMcpInstanceEnabled()) || !(await getMcpEnabled(row.userId))) return null;

  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() >= LAST_USED_GRANULARITY_MS) {
    await db.mcpToken.update({ where: { id: row.id }, data: { lastUsedAt: now } });
  }
  return {
    userId: row.userId,
    scopes: row.scope === "write" ? ["bilan:read", "bilan:write"] : ["bilan:read"],
    client: { kind: "token", id: row.id, name: row.name },
  };
}
