import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

// The route and the Server Action read the session through next/headers.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => request.headers,
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { changePasswordLimiter } from "@/server/auth/rate-limit";
import { createAccount } from "@/server/services/accounts";
import { exportOwnData } from "@/server/services/rgpd";
import { RECENT_SIGN_IN_MS } from "@/server/services/users/step-up";
import { confirmDataExportAction } from "@/server/transport/actions/account-data";
import { GET } from "@/app/api/export/data/route";

vi.setConfig({ testTimeout: 20_000 });

const tag = `export-step-up-${Date.now()}`;
const email = `${tag}@bilan.local`;
const password = "export-step-up-password-123";
const ssoId = `${tag}-sso`;
const iban = "FR7630006000011234567890189";
const userAgent = "Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0";

let userId: string;

const stale = () => new Date(Date.now() - RECENT_SIGN_IN_MS - 60_000);
const exported = () => db.auditLog.findMany({ where: { userId, action: "user.data.exported" } });

async function signIn(): Promise<void> {
  const auth = await getAuth();
  const res = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  if (!res.ok) throw new Error(`sign-in failed: ${res.status}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  request.headers = new Headers({
    cookie,
    "user-agent": userAgent,
    "x-forwarded-for": "203.0.113.9",
  });
}

async function ageSessions(): Promise<void> {
  await db.session.updateMany({ where: { userId }, data: { createdAt: stale() } });
}

beforeAll(async () => {
  const auth = await getAuth();
  userId = (await auth.api.signUpEmail({ body: { email, password, name: "Export" } })).user.id;
  await db.user.create({ data: { id: ssoId, email: `${ssoId}@bilan.local` } });
  await createAccount({ name: "Main", type: "CHECKING", iban }, userId);
});

beforeEach(async () => {
  changePasswordLimiter.reset(userId);
  await db.auditLog.deleteMany({ where: { userId } });
});

afterAll(async () => {
  changePasswordLimiter.reset(userId);
  await db.bankAccount.deleteMany({ where: { ownerId: userId } });
  await db.verification.deleteMany({ where: { value: { in: [userId, ssoId] } } });
  await db.auditLog.deleteMany({ where: { userId: { in: [userId, ssoId] } } });
  await db.user.deleteMany({ where: { id: { in: [userId, ssoId] } } });
  await db.$disconnect();
});

describe("GET /api/export/data step-up (#257)", () => {
  it("exports right after sign-in, IBAN included, and audits it", async () => {
    await signIn();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accounts.map((a: { iban: string }) => a.iban)).toEqual([iban]);
    const [audit] = await exported();
    expect(audit).toMatchObject({
      entity: "User",
      entityId: userId,
      metadata: { via: "recent_sign_in" },
      ipAddress: "203.0.113.9",
      userAgent,
    });
  });

  it("refuses an older session with the re-auth method and audits nothing", async () => {
    await signIn();
    await ageSessions();
    const res = await GET();
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "REAUTH_REQUIRED", method: "PASSWORD" });
    expect(await exported()).toHaveLength(0);
  });

  it("exports once the password is confirmed on this session", async () => {
    await signIn();
    await ageSessions();
    expect(await confirmDataExportAction("wrong-password")).toEqual({
      ok: false,
      error: "BAD_PASSWORD",
    });
    const failed = await db.auditLog.findMany({
      where: { userId, action: "user.data.export_failed" },
    });
    expect(failed.map((a) => a.metadata)).toEqual([{ reason: "bad_password" }]);
    expect((await GET()).status).toBe(403);

    expect(await confirmDataExportAction(password)).toEqual({ ok: true });
    expect((await GET()).status).toBe(200);
    expect((await exported()).map((a) => a.metadata)).toEqual([{ via: "password" }]);

    await signIn();
    await ageSessions();
    expect((await GET()).status).toBe(403);
  });

  it("sends an account without a usable password through a new sign-in", async () => {
    const session = { id: `${tag}-sso-session`, userId: ssoId, createdAt: stale() };
    const origin = { ipAddress: null, userAgent: null };
    expect(await exportOwnData(session, origin)).toEqual({ ok: false, method: "SIGN_IN" });
  });

  it("answers 401 without a session", async () => {
    request.headers = new Headers();
    expect((await GET()).status).toBe(401);
  });
});
