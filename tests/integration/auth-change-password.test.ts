import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const notify = vi.hoisted(() => vi.fn());
vi.mock("@/server/services/mail/security-notifications", () => ({
  notifySecurityEvent: notify,
}));

import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { changePassword, hasPasswordCredential } from "@/server/services/users/password";

const email = `pwchange+${Date.now()}@bilan.local`;
const password = "original-strong-password-1";
const newPassword = "brand-new-strong-password-2";
let userId: string;

async function signIn(pw: string): Promise<Headers> {
  const auth = await getAuth();
  const res = await auth.api.signInEmail({ body: { email, password: pw }, asResponse: true });
  if (!res.ok) throw new Error(`sign-in failed: ${res.status}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return new Headers({
    cookie,
    "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0",
    "x-forwarded-for": "203.0.113.9",
  });
}

beforeAll(async () => {
  const auth = await getAuth();
  const res = await auth.api.signUpEmail({ body: { email, password, name: "Pw Change" } });
  userId = res.user.id;
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { email } });
  await db.$disconnect();
});

function badPasswordAudits() {
  return db.auditLog.count({
    where: {
      userId,
      action: "auth.password.change_failed",
      metadata: { equals: { reason: "bad_password" } },
    },
  });
}

describe("change password", () => {
  it("rejects a wrong current password", async () => {
    const headers = await signIn(password);
    const res = await changePassword(headers, {
      currentPassword: "not-the-password",
      newPassword,
      revokeOtherSessions: false,
    });
    expect(res).toEqual({ ok: false, error: "BAD_PASSWORD" });
    expect(await badPasswordAudits()).toBe(1);
  });

  it("reports a wrong current password even when the new one repeats it (#172)", async () => {
    const headers = await signIn(password);
    const res = await changePassword(headers, {
      currentPassword: "not-the-password",
      newPassword: "not-the-password",
      revokeOtherSessions: false,
    });
    expect(res).toEqual({ ok: false, error: "BAD_PASSWORD" });
    expect(await badPasswordAudits()).toBe(2);
  });

  it("rejects the current password as the new one, without auditing a change (#172)", async () => {
    const headers = await signIn(password);
    const res = await changePassword(headers, {
      currentPassword: password,
      newPassword: password,
      revokeOtherSessions: true,
    });
    expect(res).toEqual({ ok: false, error: "SAME_PASSWORD" });
    expect(await db.auditLog.count({ where: { userId, action: "auth.password.changed" } })).toBe(0);
    expect(await badPasswordAudits()).toBe(2);
    await expect(signIn(password)).resolves.toBeInstanceOf(Headers);
  });

  it("enforces the minimum password length", async () => {
    const headers = await signIn(password);
    const res = await changePassword(headers, {
      currentPassword: password,
      newPassword: "short",
      revokeOtherSessions: false,
    });
    expect(res).toEqual({ ok: false, error: "TOO_SHORT" });
  });

  it("changes the password, audits it and revokes the other sessions", async () => {
    await signIn(password);
    const headers = await signIn(password);
    expect(await db.session.count({ where: { userId } })).toBeGreaterThanOrEqual(2);

    const res = await changePassword(headers, {
      currentPassword: password,
      newPassword,
      revokeOtherSessions: true,
    });
    expect(res).toEqual({ ok: true });

    expect(await db.session.count({ where: { userId } })).toBe(1);
    const audit = await db.auditLog.count({ where: { userId, action: "auth.password.changed" } });
    expect(audit).toBe(1);
    expect(notify).toHaveBeenCalledWith("password_changed", {
      userId,
      at: expect.any(Date),
      origin: { ip: "203.0.113.9", userAgent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0" },
    });
    await expect(signIn(password)).rejects.toThrow();
    await expect(signIn(newPassword)).resolves.toBeInstanceOf(Headers);
  });

  it("keeps the other sessions when not asked to revoke them", async () => {
    const before = await db.session.count({ where: { userId } });
    const headers = await signIn(newPassword);
    const res = await changePassword(headers, {
      currentPassword: newPassword,
      newPassword: password,
      revokeOtherSessions: false,
    });
    expect(res).toEqual({ ok: true });
    expect(await db.session.count({ where: { userId } })).toBe(before + 1);
  });
});

describe("hasPasswordCredential", () => {
  it("is true for an email/password account", async () => {
    expect(await hasPasswordCredential(userId)).toBe(true);
  });

  it("is false for an SSO-only account", async () => {
    const id = `sso-${Date.now()}`;
    const sso = await db.user.create({
      data: {
        id,
        email: `${id}@bilan.local`,
        name: "SSO Only",
        authAccounts: { create: { id: `${id}-acc`, accountId: id, providerId: "oidc-test" } },
      },
    });
    try {
      expect(await hasPasswordCredential(sso.id)).toBe(false);
    } finally {
      await db.user.delete({ where: { id: sso.id } });
    }
  });
});
