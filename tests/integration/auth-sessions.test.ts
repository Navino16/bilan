import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { listSessions, revokeOtherSessions, revokeSession } from "@/server/services/users/sessions";

const stamp = Date.now();
const password = "sessions-strong-password-1";
const owner = { email: `sessions+${stamp}@bilan.local`, id: "" };
const other = { email: `sessions-other+${stamp}@bilan.local`, id: "" };

const iphoneUa =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

async function signIn(email: string): Promise<{ headers: Headers; sessionId: string }> {
  const auth = await getAuth();
  const res = await auth.api.signInEmail({
    body: { email, password },
    headers: new Headers({ "user-agent": iphoneUa }),
    asResponse: true,
  });
  if (!res.ok) throw new Error(`sign-in failed: ${res.status}`);
  const headers = new Headers({
    cookie: res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  });
  const session = await auth.api.getSession({ headers });
  if (!session) throw new Error("no session after sign-in");
  return { headers, sessionId: session.session.id };
}

beforeAll(async () => {
  const auth = await getAuth();
  for (const u of [owner, other]) {
    const res = await auth.api.signUpEmail({
      body: { email: u.email, password, name: "Sessions" },
    });
    u.id = res.user.id;
  }
  await db.session.deleteMany({ where: { userId: { in: [owner.id, other.id] } } });
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { userId: { in: [owner.id, other.id] } } });
  await db.user.deleteMany({ where: { id: { in: [owner.id, other.id] } } });
  await db.$disconnect();
});

describe("listSessions", () => {
  it("lists the user's active sessions, current first, without tokens", async () => {
    const a = await signIn(owner.email);
    const b = await signIn(owner.email);
    await signIn(other.email);

    const list = await listSessions(owner.id, b.sessionId);
    expect(list.map((s) => s.id)).toEqual([b.sessionId, a.sessionId]);
    expect(list[0]).toMatchObject({ current: true, idleDays: 0 });
    expect(list[1]).toMatchObject({
      current: false,
      browser: "Safari",
      os: "iPhone",
      mobile: true,
    });
    expect(list[0]).not.toHaveProperty("token");
  });

  it("skips expired sessions", async () => {
    const a = await signIn(owner.email);
    await db.session.update({
      where: { id: a.sessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const list = await listSessions(owner.id, null);
    expect(list.map((s) => s.id)).not.toContain(a.sessionId);
  });
});

describe("revokeSession", () => {
  it("revokes another of the user's sessions, which stops working at once", async () => {
    const a = await signIn(owner.email);
    const b = await signIn(owner.email);

    expect(await revokeSession(a.headers, b.sessionId)).toEqual({ ok: true });

    expect(await db.session.findUnique({ where: { id: b.sessionId } })).toBeNull();
    const auth = await getAuth();
    expect(await auth.api.getSession({ headers: b.headers })).toBeNull();
    const audit = await db.auditLog.findFirst({
      where: { userId: owner.id, action: "auth.session.revoked", entityId: b.sessionId },
    });
    expect(audit).not.toBeNull();
  });

  it("cannot revoke another user's session", async () => {
    const a = await signIn(owner.email);
    const foreign = await signIn(other.email);

    expect(await revokeSession(a.headers, foreign.sessionId)).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect(await db.session.findUnique({ where: { id: foreign.sessionId } })).not.toBeNull();
  });

  it("reports an unknown session id as not found", async () => {
    const a = await signIn(owner.email);
    expect(await revokeSession(a.headers, "no-such-session")).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
  });

  it("requires a signed-in caller", async () => {
    const a = await signIn(owner.email);
    expect(await revokeSession(new Headers(), a.sessionId)).toEqual({
      ok: false,
      error: "UNAUTHORIZED",
    });
    expect(await revokeOtherSessions(new Headers())).toEqual({
      ok: false,
      error: "UNAUTHORIZED",
    });
    expect(await db.session.findUnique({ where: { id: a.sessionId } })).not.toBeNull();
  });

  it("refuses to revoke the current session", async () => {
    const a = await signIn(owner.email);
    expect(await revokeSession(a.headers, a.sessionId)).toEqual({ ok: false, error: "CURRENT" });
    expect(await db.session.findUnique({ where: { id: a.sessionId } })).not.toBeNull();
  });
});

describe("revokeOtherSessions", () => {
  it("keeps only the current session and audits the count", async () => {
    await signIn(owner.email);
    await signIn(owner.email);
    const current = await signIn(owner.email);
    const foreign = await signIn(other.email);
    const active = { userId: owner.id, expiresAt: { gt: new Date() } };
    const before = await db.session.count({ where: active });

    expect(await revokeOtherSessions(current.headers)).toEqual({ ok: true, count: before - 1 });

    const left = await db.session.findMany({ where: active, select: { id: true } });
    expect(left).toEqual([{ id: current.sessionId }]);
    const auth = await getAuth();
    expect(await auth.api.getSession({ headers: current.headers })).not.toBeNull();
    expect(await db.session.findUnique({ where: { id: foreign.sessionId } })).not.toBeNull();
    const audit = await db.auditLog.findFirst({
      where: { userId: owner.id, action: "auth.session.revoked_others" },
    });
    expect(audit?.metadata).toEqual({ count: before - 1 });
  });
});
