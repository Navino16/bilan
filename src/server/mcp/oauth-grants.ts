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

// Private-use schemes (`com.example.app:/cb`) have no host: the scheme stands in for it.
export function redirectHost(uri: string): string | null {
  try {
    const url = new URL(uri);
    return url.host || url.protocol;
  } catch {
    return null;
  }
}

// `redirectUris` as the plugin stores it (a JSON list); the first URI identifies the client.
export function clientRedirectHost(redirectUris: string): string | null {
  const first = stringList(redirectUris)?.[0];
  return first ? redirectHost(first) : null;
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
      redirectHost: clientRedirectHost(row.client.redirectUris),
      access: scopes.includes("bilan:write") ? "write" : "read",
      offline: scopes.includes("offline_access"),
      authorizedAt: row.updatedAt,
      lastUsedAt: row.lastUsedAt,
    };
  });
}

// The plugin keeps pending codes in Verification as JSON. `contains` only narrows the scan: the
// signed query passes unknown params through, so a client can plant `"userId":"<other>"` in it.
async function pendingCodeIds(
  client: Prisma.TransactionClient,
  userId: string,
  clientId?: string,
  now?: Date,
): Promise<string[]> {
  const parts = ['"type":"authorization_code"', `"userId":${JSON.stringify(userId)}`];
  if (clientId) parts.push(`"client_id":${JSON.stringify(clientId)}`);
  const rows = await client.verification.findMany({
    where: {
      AND: parts.map((part) => ({ value: { contains: part } })),
      ...(now ? { expiresAt: { gt: now } } : {}),
    },
    select: { id: true, value: true },
  });
  return rows.filter((row) => isCodeOf(row.value, userId, clientId)).map((row) => row.id);
}

function isCodeOf(value: string, userId: string, clientId?: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return false;
  }
  const v = parsed as { type?: unknown; userId?: unknown; query?: { client_id?: unknown } };
  return (
    v.type === "authorization_code" &&
    v.userId === userId &&
    (clientId === undefined || v.query?.client_id === clientId)
  );
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
    const codeIds = await pendingCodeIds(tx, userId, clientId);
    await tx.verification.deleteMany({ where: { id: { in: codeIds } } });
    if (clientId && codeIds.length > 0) clients.add(clientId);
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
    pendingCodeIds(db, userId, undefined, now).then((ids) => ids.length),
  ]);
  return counts.some((n) => n > 0);
}
