import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

// The Server Action reads the session through next/headers.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => request.headers,
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { changePasswordLimiter } from "@/server/auth/rate-limit";
import { createAccount } from "@/server/services/accounts";
import { shareAccountWithGroup } from "@/server/services/accounts/sharing";
import { createGroup } from "@/server/services/groups";
import { revealAccountIban } from "@/server/services/accounts/iban-reveal";
import { RECENT_SIGN_IN_MS } from "@/server/services/users/step-up";
import { revealAccountIbanAction } from "@/server/transport/actions/accounts";

vi.setConfig({ testTimeout: 20_000 });

const tag = `iban-reveal-${Date.now()}`;
const email = `${tag}@bilan.local`;
const password = "iban-reveal-password-123";
const ssoId = `${tag}-sso`;
const memberId = `${tag}-member`;
const iban = "FR7630006000011234567890189";
const formatted = "FR76 3000 6000 0112 3456 7890 189";
const userAgent = "Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0";
const origin = { ipAddress: null, userAgent: null };

let ownerId: string;
let accountId: string;
let ssoAccountId: string;
let seq = 0;

const stale = () => new Date(Date.now() - RECENT_SIGN_IN_MS - 60_000);
const sessionOf = (userId: string, createdAt: Date) => ({
  id: `${tag}-s${seq++}`,
  userId,
  createdAt,
});

const audits = (userId: string, action: string) =>
  db.auditLog.findMany({ where: { userId, action, entity: "BankAccount" } });

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

async function ageSessions(userId: string): Promise<void> {
  await db.session.updateMany({ where: { userId }, data: { createdAt: stale() } });
}

beforeAll(async () => {
  const auth = await getAuth();
  ownerId = (await auth.api.signUpEmail({ body: { email, password, name: "Iban" } })).user.id;
  await db.user.create({ data: { id: ssoId, email: `${ssoId}@bilan.local` } });
  await db.user.create({ data: { id: memberId, email: `${memberId}@bilan.local` } });
  accountId = (await createAccount({ name: "Main", type: "CHECKING", iban }, ownerId)).id;
  ssoAccountId = (await createAccount({ name: "Sso", type: "CHECKING", iban }, ssoId)).id;
});

beforeEach(async () => {
  changePasswordLimiter.reset(ownerId);
  await db.auditLog.deleteMany({ where: { userId: { in: [ownerId, ssoId, memberId] } } });
});

afterAll(async () => {
  changePasswordLimiter.reset(ownerId);
  const ids = [ownerId, ssoId, memberId];
  await db.accountShare.deleteMany({ where: { accountId: { in: [accountId, ssoAccountId] } } });
  await db.group.deleteMany({ where: { createdById: { in: ids } } });
  await db.bankAccount.deleteMany({ where: { ownerId: { in: ids } } });
  await db.verification.deleteMany({ where: { value: { in: ids } } });
  await db.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

describe("revealAccountIban (#257)", () => {
  it("reveals right after sign-in and audits it without the IBAN", async () => {
    const session = sessionOf(ownerId, new Date());
    expect(await revealAccountIban({ accountId, session, origin })).toEqual({
      ok: true,
      iban: formatted,
    });
    const [audit] = await audits(ownerId, "account.iban.revealed");
    expect(audit.entityId).toBe(accountId);
    expect(audit.metadata).toEqual({ via: "recent_sign_in" });
  });

  it("asks an older session to re-authenticate, by password or by a new sign-in", async () => {
    expect(
      await revealAccountIban({ accountId, session: sessionOf(ownerId, stale()), origin }),
    ).toEqual({ ok: false, error: "REAUTH_REQUIRED", method: "PASSWORD" });
    expect(
      await revealAccountIban({
        accountId: ssoAccountId,
        session: sessionOf(ssoId, stale()),
        origin,
      }),
    ).toEqual({ ok: false, error: "REAUTH_REQUIRED", method: "SIGN_IN" });
    expect(await audits(ownerId, "account.iban.revealed")).toHaveLength(0);
  });

  it("never reveals to household members and audits the attempt", async () => {
    const group = await createGroup({ name: "Iban household" }, ownerId);
    await db.groupMember.create({ data: { groupId: group.id, userId: memberId, role: "MEMBER" } });
    await shareAccountWithGroup(
      { accountId, groupId: group.id, permission: "WRITE" },
      { id: ownerId },
    );
    const session = sessionOf(memberId, new Date());
    expect(await revealAccountIban({ accountId, session, origin })).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    const failed = await audits(memberId, "account.iban.reveal_failed");
    expect(failed.map((a) => [a.entityId, a.metadata])).toEqual([
      [accountId, { reason: "not_owner" }],
    ]);
    expect(await audits(memberId, "account.iban.revealed")).toHaveLength(0);
  });

  it("stays silent on unknown accounts and reports one without IBAN as not found", async () => {
    const session = sessionOf(ownerId, new Date());
    expect(await revealAccountIban({ accountId: "missing", session, origin })).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    const bare = await createAccount({ name: "Bare", type: "OTHER" }, ownerId);
    expect(await revealAccountIban({ accountId: bare.id, session, origin })).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect(await db.auditLog.count({ where: { userId: ownerId, entity: "BankAccount" } })).toBe(1);
  });
});

describe("revealAccountIbanAction (#257)", () => {
  it("reveals with a fresh session and audits the request origin", async () => {
    await signIn();
    expect(await revealAccountIbanAction(accountId)).toEqual({ ok: true, iban: formatted });
    const [audit] = await audits(ownerId, "account.iban.revealed");
    expect(audit).toMatchObject({ ipAddress: "203.0.113.9", userAgent });
  });

  it("asks an older session for the password, then lets it reveal for a few minutes", async () => {
    await signIn();
    await ageSessions(ownerId);
    expect(await revealAccountIbanAction(accountId)).toEqual({
      ok: false,
      error: "REAUTH_REQUIRED",
      method: "PASSWORD",
    });
    expect(await revealAccountIbanAction(accountId, "wrong-password")).toEqual({
      ok: false,
      error: "BAD_PASSWORD",
    });
    const [failed] = await audits(ownerId, "account.iban.reveal_failed");
    expect(failed).toMatchObject({
      entityId: accountId,
      metadata: { reason: "bad_password" },
      ipAddress: "203.0.113.9",
    });

    expect(await revealAccountIbanAction(accountId, password)).toEqual({
      ok: true,
      iban: formatted,
    });
    expect(await revealAccountIbanAction(accountId)).toEqual({ ok: true, iban: formatted });
    const vias = (await audits(ownerId, "account.iban.revealed")).map((a) => a.metadata);
    expect(vias).toEqual([{ via: "password" }, { via: "password" }]);
  });

  it("checks no password for an account the caller doesn't own", async () => {
    await signIn();
    await ageSessions(ownerId);
    for (let i = 0; i < 6; i++) {
      expect(await revealAccountIbanAction(ssoAccountId, "wrong-password")).toEqual({
        ok: false,
        error: "NOT_FOUND",
      });
    }
    expect(await revealAccountIbanAction(accountId, password)).toMatchObject({ ok: true });
  });

  it("rate-limits wrong passwords", async () => {
    await signIn();
    await ageSessions(ownerId);
    for (let i = 0; i < 5; i++) await revealAccountIbanAction(accountId, "wrong-password");
    expect(await revealAccountIbanAction(accountId, password)).toMatchObject({
      ok: false,
      error: "RATE_LIMITED",
    });
  });

  it("rejects a malformed account id without touching the database", async () => {
    await signIn();
    expect(await revealAccountIbanAction(42)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await revealAccountIbanAction("x".repeat(5000))).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
  });
});
