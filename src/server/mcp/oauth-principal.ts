import { db } from "@/server/db";
import { getMcpEnabled } from "@/server/services/users/preferences";
import type { McpPrincipal, McpScope } from "./context";
import { OAUTH_ACCESS_TOKEN_PREFIX, mcpResourceUrl, oauthTokenHash } from "./oauth-config";
import { isMcpInstanceEnabled } from "./switches";

const LAST_USED_GRANULARITY_MS = 60_000;

export function oauthScopesToMcp(scopes: string[]): McpScope[] {
  if (scopes.includes("bilan:write")) return ["bilan:read", "bilan:write"];
  if (scopes.includes("bilan:read")) return ["bilan:read"];
  return [];
}

// The plugin's adapter stores string[] columns as JSON on MariaDB.
function stringList(value: string | null): string[] | null {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((v) => typeof v === "string") ? parsed : null;
  } catch {
    return null;
  }
}

async function touchConsent(userId: string, clientId: string, now: Date): Promise<void> {
  try {
    await db.oauthConsent.updateMany({
      where: {
        userId,
        clientId,
        OR: [
          { lastUsedAt: null },
          { lastUsedAt: { lt: new Date(now.getTime() - LAST_USED_GRANULARITY_MS) } },
        ],
      },
      data: { lastUsedAt: now },
    });
  } catch (e) {
    console.error("[bilan] OAuth consent lastUsedAt update failed", e);
  }
}

// Resolved by Bilan rather than the plugin's validator, so a grant outlives the browser
// session that created it (spec §5.18).
export async function principalFromOAuthToken(
  token: string,
): Promise<McpPrincipal | "insufficient_scope" | null> {
  if (!token.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)) return null;
  const now = new Date();
  const row = await db.oauthAccessToken.findUnique({
    where: { token: oauthTokenHash(token.slice(OAUTH_ACCESS_TOKEN_PREFIX.length)) },
    include: {
      user: { select: { banned: true } },
      client: { select: { disabled: true, name: true } },
    },
  });
  if (
    !row ||
    row.revoked ||
    row.expiresAt <= now ||
    !row.userId ||
    !row.user ||
    row.user.banned ||
    row.client.disabled
  ) {
    return null;
  }
  const resources = stringList(row.resources);
  if (!resources || (resources.length > 0 && !resources.includes(mcpResourceUrl()))) return null;
  if (!(await isMcpInstanceEnabled()) || !(await getMcpEnabled(row.userId))) return null;

  const scopes = oauthScopesToMcp(stringList(row.scopes) ?? []);
  if (scopes.length === 0) return "insufficient_scope";

  await touchConsent(row.userId, row.clientId, now);
  return {
    userId: row.userId,
    scopes,
    client: { kind: "oauth", id: row.clientId, name: row.client.name ?? row.clientId },
  };
}
