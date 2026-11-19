import { db } from "@/server/db";

const STALE_CLIENT_AGE_MS = 7 * 86_400_000;

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
