import type { PrismaClient } from "@prisma/client";
import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import { describeUserAgent } from "@/lib/user-agent";

const TRUST_PREFIX = "trust-device-";
// The grant is written in the same request as the sign-in's session.
const SESSION_MATCH_MS = 10_000;

export type TrustedDeviceView = {
  id: string;
  browser: string | null;
  os: string | null;
  mobile: boolean;
  // Better Auth replaces the grant at each password sign-in it skips the code for.
  lastUsedAt: Date;
  expiresAt: Date;
  current: boolean;
};

export type RevokeTrustedDeviceError = "NOT_FOUND";

const ownGrants = (userId: string) => ({
  value: userId,
  identifier: { startsWith: TRUST_PREFIX },
});

// Better Auth stores each "trust this device" grant (2FA skipped at sign-in) as a
// verification row; the browser's cookie is useless once its row is gone.
export async function purgeTrustedDevices(
  userId: string,
  database: PrismaClient = db,
): Promise<number> {
  const { count } = await database.verification.deleteMany({ where: ownGrants(userId) });
  return count;
}

// Grants carry no device details: they are borrowed from the session signed in with them.
export async function listTrustedDevices(
  userId: string,
  currentSessionId: string | null,
  now: Date = new Date(),
): Promise<TrustedDeviceView[]> {
  const grants = await db.verification.findMany({
    where: { ...ownGrants(userId), expiresAt: { gt: now } },
    select: { id: true, createdAt: true, expiresAt: true },
    orderBy: { createdAt: "desc" },
  });
  if (grants.length === 0) return [];
  const times = grants.map((g) => g.createdAt.getTime());
  const sessions = await db.session.findMany({
    where: {
      userId,
      createdAt: {
        gte: new Date(Math.min(...times) - SESSION_MATCH_MS),
        lte: new Date(Math.max(...times) + SESSION_MATCH_MS),
      },
    },
    select: { id: true, userAgent: true, createdAt: true },
  });
  return grants.map((g) => {
    const distance = (s: { createdAt: Date }) =>
      Math.abs(s.createdAt.getTime() - g.createdAt.getTime());
    const session = sessions
      .filter((s) => distance(s) <= SESSION_MATCH_MS)
      .sort((a, b) => distance(a) - distance(b))[0];
    return {
      id: g.id,
      ...describeUserAgent(session?.userAgent ?? null),
      lastUsedAt: g.createdAt,
      expiresAt: g.expiresAt,
      current: Boolean(session && session.id === currentSessionId),
    };
  });
}

export async function revokeTrustedDevice(
  userId: string,
  id: string,
): Promise<{ ok: true } | { ok: false; error: RevokeTrustedDeviceError }> {
  const { count } = await db.verification.deleteMany({ where: { id, ...ownGrants(userId) } });
  if (count === 0) return { ok: false, error: "NOT_FOUND" };
  await logEvent({
    userId,
    action: "auth.trusted_device.revoked",
    entity: "TrustedDevice",
    entityId: id,
  });
  return { ok: true };
}

export async function revokeAllTrustedDevices(userId: string): Promise<{ count: number }> {
  const count = await purgeTrustedDevices(userId);
  if (count > 0) {
    await logEvent({ userId, action: "auth.trusted_device.revoked_all", metadata: { count } });
  }
  return { count };
}
