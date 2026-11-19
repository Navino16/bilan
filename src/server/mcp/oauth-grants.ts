import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import { stringList } from "./oauth-principal";

const STALE_CLIENT_AGE_MS = 7 * 86_400_000;
const CLIENT_NAME_MAX = 80;

// Self-registered clients nobody ever authorized (spec §5.18).
export async function purgeStaleOAuthClients(now: Date = new Date()): Promise<number> {
  const { count } = await db.oauthClient.deleteMany({
    where: {
      userId: null,
      createdAt: { lt: new Date(now.getTime() - STALE_CLIENT_AGE_MS) },
      consents: { none: {} },
      accessTokens: { none: {} },
      refreshTokens: { none: {} },
    },
  });
  return count;
}

export type OAuthGrantView = {
  clientId: string;
  name: string | null;
  redirectHost: string | null;
  access: "read" | "write";
  offline: boolean;
  authorizedAt: Date;
  lastUsedAt: Date | null;
};

export function clientDisplayName(name: string | null): string | null {
  return name === null ? null : Array.from(name).slice(0, CLIENT_NAME_MAX).join("");
}

function redirectHost(redirectUris: string): string | null {
  const first = stringList(redirectUris)?.[0];
  if (!first) return null;
  try {
    return new URL(first).host || null;
  } catch {
    return null;
  }
}

export async function listOAuthGrants(userId: string): Promise<OAuthGrantView[]> {
  const rows = await db.oauthConsent.findMany({
    where: { userId },
    select: {
      clientId: true,
      scopes: true,
      updatedAt: true,
      lastUsedAt: true,
      client: { select: { name: true, redirectUris: true } },
    },
    // The plugin stamps consents to the second.
    orderBy: [{ updatedAt: "desc" }, { clientId: "asc" }],
  });
  return rows.map((row) => {
    const scopes = stringList(row.scopes) ?? [];
    return {
      clientId: row.clientId,
      name: clientDisplayName(row.client.name),
      redirectHost: redirectHost(row.client.redirectUris),
      access: scopes.includes("bilan:write") ? "write" : "read",
      offline: scopes.includes("offline_access"),
      authorizedAt: row.updatedAt,
      lastUsedAt: row.lastUsedAt,
    };
  });
}

// The plugin keeps pending codes in Verification, keyed by the code's hash; the JSON value
// (no whitespace, quotes inside strings escaped) carries the user and the client.
function pendingCodes(userId: string, clientId?: string): Prisma.VerificationWhereInput {
  const parts = ['"type":"authorization_code"', `"userId":${JSON.stringify(userId)}`];
  if (clientId) parts.push(`"client_id":${JSON.stringify(clientId)}`);
  return { AND: parts.map((part) => ({ value: { contains: part } })) };
}

// Deletes tokens, consents and pending codes; returns the clients that had any.
async function deleteGrants(userId: string, clientId?: string): Promise<Set<string>> {
  const where = { userId, ...(clientId ? { clientId } : {}) };
  return db.$transaction(async (tx) => {
    const [consents, access, refresh] = await Promise.all([
      tx.oauthConsent.findMany({ where, select: { clientId: true } }),
      tx.oauthAccessToken.findMany({ where, select: { clientId: true } }),
      tx.oauthRefreshToken.findMany({ where, select: { clientId: true } }),
    ]);
    const clients = new Set([...consents, ...access, ...refresh].map((r) => r.clientId));
    await tx.oauthAccessToken.deleteMany({ where });
    await tx.oauthRefreshToken.deleteMany({ where });
    await tx.oauthConsent.deleteMany({ where });
    const codes = await tx.verification.deleteMany({ where: pendingCodes(userId, clientId) });
    if (clientId && codes.count > 0) clients.add(clientId);
    return clients;
  });
}

export async function revokeOAuthGrant(userId: string, clientId: string): Promise<void> {
  const client = await db.oauthClient.findUnique({ where: { clientId }, select: { name: true } });
  if (!client || (await deleteGrants(userId, clientId)).size === 0) throw new Error("NOT_FOUND");
  await logEvent({
    userId,
    action: "mcp.client.revoked",
    entity: "OauthClient",
    entityId: clientId,
    metadata: { name: clientDisplayName(client.name) },
  });
}

export async function revokeAllOAuthGrants(
  userId: string,
  reason: "password" | "sessions",
): Promise<number> {
  const count = (await deleteGrants(userId)).size;
  if (count === 0) return 0;
  await logEvent({
    userId,
    action: "mcp.client.revoked_all",
    entity: "OauthClient",
    metadata: { reason, count },
  }).catch((e) => console.error("[bilan] OAuth grant revocation audit failed", e));
  return count;
}

export async function hasLiveOAuthGrants(userId: string, now: Date = new Date()): Promise<boolean> {
  const live = { userId, revoked: null, expiresAt: { gt: now } };
  const counts = await Promise.all([
    db.oauthConsent.count({ where: { userId } }),
    db.oauthAccessToken.count({ where: live }),
    db.oauthRefreshToken.count({ where: live }),
    db.verification.count({ where: { ...pendingCodes(userId), expiresAt: { gt: now } } }),
  ]);
  return counts.some((n) => n > 0);
}
