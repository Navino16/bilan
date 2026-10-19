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
import { appSettings } from "@/server/services/settings/app-settings";
import { createAccount } from "@/server/services/accounts";
import { shareAccountWithGroup } from "@/server/services/accounts/sharing";
import { createGroup } from "@/server/services/groups";
import { IBAN_REVEAL_WINDOW_MS, revealAccountIban } from "@/server/services/accounts/iban-reveal";
import { revealAccountIbanAction } from "@/server/transport/actions/accounts";
import { snapshotSetting } from "./support/app-setting-snapshot";

vi.setConfig({ testTimeout: 20_000 });

const tag = `iban-reveal-${Date.now()}`;
const email = `${tag}@bilan.local`;
const password = "iban-reveal-password-123";
const ssoId = `${tag}-sso`;
const memberId = `${tag}-member`;
const iban = "FR7630006000011234567890189";
const formatted = "FR76 3000 6000 0112 3456 7890 189";

let ownerId: string;
let accountId: string;
let ssoAccountId: string;
let restoreCredentials: () => Promise<void>;

const fresh = () => new Date();
const stale = () => new Date(Date.now() - IBAN_REVEAL_WINDOW_MS - 60_000);

const audits = (where: { userId?: string; action: string }) =>
  db.auditLog.findMany({ where: { ...where, entity: "BankAccount" } });

async function signIn(): Promise<void> {
  const auth = await getAuth();
  const res = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  if (!res.ok) throw new Error(`sign-in failed: ${res.status}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  request.headers = new Headers({ cookie });
}

async function ageSessions(userId: string): Promise<void> {
  await db.session.updateMany({ where: { userId }, data: { createdAt: stale() } });
}

beforeAll(async () => {
  restoreCredentials = await snapshotSetting("credentials_enabled");
  const auth = await getAuth();
  ownerId = (await auth.api.signUpEmail({ body: { email, password, name: "Iban" } })).user.id;
  await db.user.create({ data: { id: ssoId, email: `${ssoId}@bilan.local` } });
  await db.user.create({ data: { id: memberId, email: `${memberId}@bilan.local` } });
  accountId = (await createAccount({ name: "Main", type: "CHECKING", iban }, ownerId)).id;
  ssoAccountId = (await createAccount({ name: "Sso", type: "CHECKING", iban }, ssoId)).id;
});

beforeEach(async () => {
  changePasswordLimiter.reset(ownerId);
  await appSettings.set("credentials_enabled", true, ownerId);
});

afterAll(async () => {
  changePasswordLimiter.reset(ownerId);
  await restoreCredentials();
  const ids = [ownerId, ssoId, memberId];
  await db.accountShare.deleteMany({ where: { accountId: { in: [accountId, ssoAccountId] } } });
  await db.group.deleteMany({ where: { createdById: { in: ids } } });
  await db.bankAccount.deleteMany({ where: { ownerId: { in: ids } } });
  await db.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

describe("revealAccountIban (#257)", () => {
  it("reveals right after sign-in and audits it without the IBAN", async () => {
    const res = await revealAccountIban({ accountId, userId: ownerId, sessionCreatedAt: fresh() });
    expect(res).toEqual({ ok: true, iban: formatted });
    const [audit] = await audits({ userId: ownerId, action: "account.iban.revealed" });
    expect(audit.entityId).toBe(accountId);
    expect(audit.metadata).toEqual({ via: "recent_sign_in" });
    await db.auditLog.deleteMany({ where: { userId: ownerId } });
  });

  it("asks a stale session with a password for that password", async () => {
    const input = { accountId, userId: ownerId, sessionCreatedAt: stale() };
    expect(await revealAccountIban(input)).toEqual({
      ok: false,
      error: "REAUTH_REQUIRED",
      method: "PASSWORD",
    });
    expect(await revealAccountIban({ ...input, password: "wrong-password" })).toEqual({
      ok: false,
      error: "BAD_PASSWORD",
    });
    const failed = await audits({ userId: ownerId, action: "account.iban.reveal_failed" });
    expect(failed.map((a) => [a.entityId, a.metadata])).toEqual([
      [accountId, { reason: "bad_password" }],
    ]);
    expect(await audits({ userId: ownerId, action: "account.iban.revealed" })).toHaveLength(0);

    expect(await revealAccountIban({ ...input, password })).toEqual({ ok: true, iban: formatted });
    const [revealed] = await audits({ userId: ownerId, action: "account.iban.revealed" });
    expect(revealed.metadata).toEqual({ via: "password" });
    await db.auditLog.deleteMany({ where: { userId: ownerId } });
  });

  it("sends a stale session without a usable password through a new sign-in", async () => {
    const sso = { accountId: ssoAccountId, userId: ssoId, sessionCreatedAt: stale() };
    expect(await revealAccountIban({ ...sso, password })).toEqual({
      ok: false,
      error: "REAUTH_REQUIRED",
      method: "SIGN_IN",
    });
    expect(await revealAccountIban({ ...sso, sessionCreatedAt: fresh() }).then((r) => r.ok)).toBe(
      true,
    );

    await appSettings.set("credentials_enabled", false, ownerId);
    expect(
      await revealAccountIban({ accountId, userId: ownerId, sessionCreatedAt: stale(), password }),
    ).toEqual({ ok: false, error: "REAUTH_REQUIRED", method: "SIGN_IN" });
  });

  it("never reveals to household members the account is shared with", async () => {
    const group = await createGroup({ name: "Iban household" }, ownerId);
    await db.groupMember.create({ data: { groupId: group.id, userId: memberId, role: "MEMBER" } });
    await shareAccountWithGroup(
      { accountId, groupId: group.id, permission: "WRITE" },
      { id: ownerId },
    );
    expect(
      await revealAccountIban({ accountId, userId: memberId, sessionCreatedAt: fresh() }),
    ).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await audits({ userId: memberId, action: "account.iban.revealed" })).toHaveLength(0);
  });

  it("reports an account without IBAN as not found", async () => {
    const bare = await createAccount({ name: "Bare", type: "OTHER" }, ownerId);
    expect(
      await revealAccountIban({ accountId: bare.id, userId: ownerId, sessionCreatedAt: fresh() }),
    ).toEqual({ ok: false, error: "NOT_FOUND" });
  });
});

describe("revealAccountIbanAction (#257)", () => {
  it("reveals with a fresh session and asks again once it is older than 10 minutes", async () => {
    await signIn();
    expect(await revealAccountIbanAction(accountId)).toEqual({ ok: true, iban: formatted });
    await ageSessions(ownerId);
    expect(await revealAccountIbanAction(accountId)).toEqual({
      ok: false,
      error: "REAUTH_REQUIRED",
      method: "PASSWORD",
    });
    expect(await revealAccountIbanAction(accountId, password)).toEqual({
      ok: true,
      iban: formatted,
    });
  });

  it("rate-limits wrong passwords and audits the refusal", async () => {
    await signIn();
    await ageSessions(ownerId);
    for (let i = 0; i < 5; i++) {
      expect(await revealAccountIbanAction(accountId, "wrong-password")).toEqual({
        ok: false,
        error: "BAD_PASSWORD",
      });
    }
    const limited = await revealAccountIbanAction(accountId, password);
    expect(limited).toMatchObject({ ok: false, error: "RATE_LIMITED" });
    const refused = await db.auditLog.count({
      where: {
        userId: ownerId,
        action: "account.iban.reveal_failed",
        metadata: { equals: { reason: "rate_limit" } },
      },
    });
    expect(refused).toBe(1);
  });

  it("rejects a malformed account id", async () => {
    await signIn();
    expect(await revealAccountIbanAction(42)).toEqual({ ok: false, error: "NOT_FOUND" });
  });
});
