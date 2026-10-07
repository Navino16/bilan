import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { logEvent } from "@/server/services/audit";
import { describeUserAgent } from "@/lib/user-agent";
import { normalizeIp } from "@/lib/ip";

const DAY_MS = 24 * 60 * 60 * 1000;

export type SessionView = {
  id: string;
  browser: string | null;
  os: string | null;
  mobile: boolean;
  ipAddress: string | null;
  signedInAt: Date;
  // better-auth bumps updatedAt at most once a day (session.updateAge), so day granularity.
  idleDays: number;
  current: boolean;
};

export type RevokeSessionError = "NOT_FOUND" | "CURRENT" | "UNAUTHORIZED" | "FAILED";

// Tokens never leave the server: sessions are addressed by id.
export async function listSessions(
  userId: string,
  currentSessionId: string | null,
  now: Date = new Date(),
): Promise<SessionView[]> {
  const rows = await db.session.findMany({
    where: { userId, expiresAt: { gt: now } },
    select: { id: true, userAgent: true, ipAddress: true, createdAt: true, updatedAt: true },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });
  return rows
    .map((r) => ({
      id: r.id,
      ...describeUserAgent(r.userAgent),
      ipAddress: normalizeIp(r.ipAddress),
      signedInAt: r.createdAt,
      idleDays: Math.max(0, Math.floor((now.getTime() - r.updatedAt.getTime()) / DAY_MS)),
      current: r.id === currentSessionId,
    }))
    .sort((a, b) => Number(b.current) - Number(a.current));
}

async function currentSession(headers: Headers) {
  const auth = await getAuth();
  const res = await auth.api.getSession({ headers });
  return res ? { auth, userId: res.user.id, sessionId: res.session.id } : null;
}

export async function revokeSession(
  headers: Headers,
  sessionId: string,
): Promise<{ ok: true } | { ok: false; error: RevokeSessionError }> {
  const me = await currentSession(headers);
  if (!me) return { ok: false, error: "UNAUTHORIZED" };
  if (sessionId === me.sessionId) return { ok: false, error: "CURRENT" };
  // better-auth's revokeSession silently no-ops on a foreign token, so ownership is checked here.
  const target = await db.session.findFirst({
    where: { id: sessionId, userId: me.userId },
    select: { token: true },
  });
  if (!target) return { ok: false, error: "NOT_FOUND" };

  try {
    await me.auth.api.revokeSession({ body: { token: target.token }, headers });
  } catch (err) {
    console.error("[bilan] revokeSession failed", err);
    return { ok: false, error: "FAILED" };
  }
  await logEvent({
    userId: me.userId,
    action: "auth.session.revoked",
    entity: "Session",
    entityId: sessionId,
  });
  return { ok: true };
}

export async function revokeOtherSessions(
  headers: Headers,
): Promise<{ ok: true; count: number } | { ok: false; error: "UNAUTHORIZED" | "FAILED" }> {
  const me = await currentSession(headers);
  if (!me) return { ok: false, error: "UNAUTHORIZED" };
  const count = await db.session.count({
    where: { userId: me.userId, id: { not: me.sessionId }, expiresAt: { gt: new Date() } },
  });
  try {
    await me.auth.api.revokeOtherSessions({ headers });
  } catch (err) {
    console.error("[bilan] revokeOtherSessions failed", err);
    return { ok: false, error: "FAILED" };
  }
  await logEvent({ userId: me.userId, action: "auth.session.revoked_others", metadata: { count } });
  return { ok: true, count };
}
