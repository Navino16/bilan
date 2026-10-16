import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => request.headers,
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

import { symmetricDecrypt } from "better-auth/crypto";
import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { changePasswordLimiter } from "@/server/auth/rate-limit";
import { claimTotpStep, hotp, totpStep } from "@/server/auth/totp-replay";
import { changePasswordAction } from "@/server/transport/actions/auth";
import {
  disableTwoFactorAction,
  enableTwoFactorAction,
  regenerateBackupCodesAction,
} from "@/server/transport/actions/two-factor";
import { countBackupCodes } from "@/server/services/users/two-factor";

const email = `tfa-actions+${Date.now()}@bilan.local`;
const password = "two-factor-actions-password";
let userId: string;

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

// Enrols through the action, then marks the enrolment confirmed as the first TOTP would.
async function enrolled(): Promise<{ secret: string; backupCodes: string[] }> {
  const res = await enableTwoFactorAction(password);
  if (!res.ok) throw new Error(`enable failed: ${res.error}`);
  const row = await db.twoFactor.findFirstOrThrow({ where: { userId } });
  const { secretConfig } = await (await getAuth()).$context;
  const secret = await symmetricDecrypt({ key: secretConfig, data: row.secret });
  await db.twoFactor.update({ where: { id: row.id }, data: { verified: true } });
  await db.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
  return { secret, backupCodes: res.data.backupCodes };
}

const totpNow = (secret: string, offset = 0) => hotp(secret, totpStep(Date.now()) + offset);
const twoFactorOn = async () =>
  (await db.user.findUniqueOrThrow({ where: { id: userId } })).twoFactorEnabled;

const audits = (action: string, reason: string) =>
  db.auditLog.count({ where: { userId, action, metadata: { equals: { reason } } } });

beforeAll(async () => {
  const auth = await getAuth();
  userId = (await auth.api.signUpEmail({ body: { email, password, name: "Tfa" } })).user.id;
});

beforeEach(async () => {
  changePasswordLimiter.reset(userId);
  await db.user.update({ where: { id: userId }, data: { twoFactorEnabled: false } });
  await db.twoFactor.deleteMany({ where: { userId } });
  await signIn();
});

afterAll(async () => {
  changePasswordLimiter.reset(userId);
  await db.auditLog.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { email } });
  await db.$disconnect();
});

describe("two-factor Server Actions (#200)", () => {
  it("refuses a wrong password and audits it", async () => {
    expect(await enableTwoFactorAction("wrong-password")).toEqual({
      ok: false,
      error: "BAD_PASSWORD",
    });
    expect(await disableTwoFactorAction("wrong-password", "123456")).toEqual({
      ok: false,
      error: "BAD_PASSWORD",
    });
    expect(await audits("auth.2fa.enable_failed", "bad_password")).toBe(1);
    expect(await audits("auth.2fa.disable_failed", "bad_password")).toBe(1);
  });

  it("returns the TOTP URI and backup codes to the client", async () => {
    const res = await enableTwoFactorAction(password);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.totpURI).toMatch(/^otpauth:\/\/totp\/.+secret=/);
    expect(res.data.backupCodes.length).toBeGreaterThan(0);
    expect(await db.twoFactor.count({ where: { userId } })).toBe(1);
  });

  it("refuses to re-enrol over an enabled 2FA, keeping its secret (#243)", async () => {
    await enrolled();
    const before = await db.twoFactor.findFirstOrThrow({ where: { userId } });
    expect(await enableTwoFactorAction(password)).toEqual({ ok: false, error: "ALREADY_ENABLED" });
    const after = await db.twoFactor.findFirstOrThrow({ where: { userId } });
    expect(after).toMatchObject({ id: before.id, secret: before.secret, verified: true });
  });

  it("disables two-factor with the password and a TOTP code, and audits it (#243)", async () => {
    const { secret } = await enrolled();
    expect(await disableTwoFactorAction(password, " ")).toEqual({ ok: false, error: "BAD_CODE" });
    expect(await disableTwoFactorAction(password, totpNow(secret, 100))).toEqual({
      ok: false,
      error: "BAD_CODE",
    });
    expect(await disableTwoFactorAction(password, "abcde-fghij")).toEqual({
      ok: false,
      error: "BAD_CODE",
    });
    expect(await audits("auth.2fa.disable_failed", "bad_code")).toBe(2);
    expect(await twoFactorOn()).toBe(true);

    expect(await disableTwoFactorAction(password, totpNow(secret))).toEqual({
      ok: true,
      data: null,
    });
    expect(await twoFactorOn()).toBe(false);
    expect(await db.twoFactor.count({ where: { userId } })).toBe(0);
    expect(await db.auditLog.count({ where: { userId, action: "auth.2fa.disabled" } })).toBe(1);
  });

  it("refuses a TOTP code already used, e.g. at sign-in (#243)", async () => {
    const { secret } = await enrolled();
    const row = await db.twoFactor.findFirstOrThrow({ where: { userId } });
    // Claims the next step too, so a step boundary mid-test can't make the code fresh.
    expect(await claimTotpStep(row.id, totpStep(Date.now()) + 1)).toBe(true);
    expect(await disableTwoFactorAction(password, totpNow(secret))).toEqual({
      ok: false,
      error: "BAD_CODE",
    });
    expect(await twoFactorOn()).toBe(true);
  });

  it("disables two-factor with a backup code (#243)", async () => {
    const { backupCodes } = await enrolled();
    expect(await disableTwoFactorAction(password, backupCodes[0])).toEqual({
      ok: true,
      data: null,
    });
    expect(await twoFactorOn()).toBe(false);
  });

  it("checks the password before spending the code (#243)", async () => {
    const { secret } = await enrolled();
    const code = totpNow(secret);
    expect(await disableTwoFactorAction("wrong-password", code)).toEqual({
      ok: false,
      error: "BAD_PASSWORD",
    });
    expect(await disableTwoFactorAction(password, code)).toEqual({ ok: true, data: null });
  });

  it("has nothing to disable without an enabled 2FA", async () => {
    expect(await disableTwoFactorAction(password, "123456")).toEqual({
      ok: false,
      error: "NOT_ENABLED",
    });
  });

  it("redirects to the login page without a session, without checking the password", async () => {
    request.headers = new Headers();
    await expect(enableTwoFactorAction(password)).rejects.toThrow("NEXT_REDIRECT");
    await expect(disableTwoFactorAction(password, "123456")).rejects.toThrow("NEXT_REDIRECT");
    expect(changePasswordLimiter.consume(userId)).toMatchObject({ allowed: true });
  });

  it("shares the per-user password limiter with change-password and audits it", async () => {
    for (let i = 0; i < 5; i++) changePasswordLimiter.consume(userId);
    const res = await enableTwoFactorAction(password);
    expect(res).toMatchObject({ ok: false, error: "RATE_LIMITED" });
    if (!res.ok) expect(res.retryAfter).toBeGreaterThan(0);
    expect(await disableTwoFactorAction(password, "123456")).toMatchObject({
      error: "RATE_LIMITED",
    });
    expect(await audits("auth.2fa.enable_failed", "rate_limit")).toBe(1);
    expect(await audits("auth.2fa.disable_failed", "rate_limit")).toBe(1);
  });
});

describe("backup code regeneration (#256)", () => {
  const storedCodes = async () => {
    const row = await db.twoFactor.findFirstOrThrow({ where: { userId } });
    const { secretConfig } = await (await getAuth()).$context;
    return JSON.parse(await symmetricDecrypt({ key: secretConfig, data: row.backupCodes }));
  };

  it("refuses a wrong password or code and keeps the current codes", async () => {
    const { secret, backupCodes } = await enrolled();
    expect(await regenerateBackupCodesAction("wrong-password", totpNow(secret))).toEqual({
      ok: false,
      error: "BAD_PASSWORD",
    });
    expect(await regenerateBackupCodesAction(password, "abcde-fghij")).toEqual({
      ok: false,
      error: "BAD_CODE",
    });
    expect(await audits("auth.2fa.backup_codes_failed", "bad_password")).toBe(1);
    expect(await audits("auth.2fa.backup_codes_failed", "bad_code")).toBe(1);
    expect(await storedCodes()).toEqual(backupCodes);
  });

  it("replaces every code after a TOTP re-authentication, and audits it", async () => {
    const { secret, backupCodes } = await enrolled();
    const res = await regenerateBackupCodesAction(password, totpNow(secret));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.backupCodes).toHaveLength(backupCodes.length);
    expect(res.data.backupCodes.some((c) => backupCodes.includes(c))).toBe(false);
    expect(await storedCodes()).toEqual(res.data.backupCodes);
    expect(await countBackupCodes(userId)).toBe(backupCodes.length);
    expect(
      await db.auditLog.count({ where: { userId, action: "auth.2fa.backup_codes_regenerated" } }),
    ).toBe(1);
    expect(await twoFactorOn()).toBe(true);
  });

  it("accepts a backup code, which the old set then no longer offers", async () => {
    const { backupCodes } = await enrolled();
    const res = await regenerateBackupCodesAction(password, backupCodes[0]);
    expect(res.ok).toBe(true);
    expect(await regenerateBackupCodesAction(password, backupCodes[1])).toEqual({
      ok: false,
      error: "BAD_CODE",
    });
  });

  it("has nothing to regenerate without an enabled 2FA", async () => {
    expect(await regenerateBackupCodesAction(password, "123456")).toEqual({
      ok: false,
      error: "NOT_ENABLED",
    });
    expect(await countBackupCodes(userId)).toBeNull();
  });

  it("shares the per-user password limiter", async () => {
    await enrolled();
    for (let i = 0; i < 5; i++) changePasswordLimiter.consume(userId);
    expect(await regenerateBackupCodesAction(password, "123456")).toMatchObject({
      error: "RATE_LIMITED",
    });
    expect(await audits("auth.2fa.backup_codes_failed", "rate_limit")).toBe(1);
  });
});

function changePasswordForm(currentPassword: string, newPassword = "unused-new-password-123") {
  const form = new FormData();
  form.set("currentPassword", currentPassword);
  form.set("newPassword", newPassword);
  form.set("confirmPassword", newPassword);
  form.set("revokeOtherSessions", "false");
  return form;
}

describe("password re-auth rate limits (#230)", () => {
  it("shares one budget between 2FA settings and password change", async () => {
    for (let i = 0; i < 4; i++) {
      expect(await disableTwoFactorAction("wrong-password", "123456")).toMatchObject({
        error: "BAD_PASSWORD",
      });
    }
    expect(await changePasswordAction(null, changePasswordForm("wrong-password"))).toMatchObject({
      error: "BAD_PASSWORD",
    });
    expect(await changePasswordAction(null, changePasswordForm(password))).toMatchObject({
      error: "RATE_LIMITED",
    });
    expect(await enableTwoFactorAction(password)).toMatchObject({ error: "RATE_LIMITED" });
  });

  it("only counts wrong passwords and codes from the 2FA settings", async () => {
    const { secret } = await enrolled();
    for (let i = 0; i < 3; i++) changePasswordLimiter.consume(userId);
    expect(await disableTwoFactorAction(password, totpNow(secret, 100))).toEqual({
      ok: false,
      error: "BAD_CODE",
    });
    expect(await disableTwoFactorAction(password, totpNow(secret))).toEqual({
      ok: true,
      data: null,
    });
    await signIn();
    expect(await disableTwoFactorAction("wrong-password", "123456")).toEqual({
      ok: false,
      error: "BAD_PASSWORD",
    });
    expect(await disableTwoFactorAction("wrong-password", "123456")).toMatchObject({
      error: "RATE_LIMITED",
    });
  });

  it("only counts wrong passwords from the password change", async () => {
    for (let i = 0; i < 4; i++) changePasswordLimiter.consume(userId);
    expect(await changePasswordAction(null, changePasswordForm(password, password))).toMatchObject({
      ok: false,
      error: "SAME_PASSWORD",
    });
    expect(await changePasswordAction(null, changePasswordForm("wrong-password"))).toMatchObject({
      ok: false,
      error: "BAD_PASSWORD",
    });
    const res = await changePasswordAction(null, changePasswordForm("wrong-password"));
    expect(res).toMatchObject({ ok: false, error: "RATE_LIMITED" });
    if (res && !res.ok) expect(res.retryAfter).toBeGreaterThan(0);
  });
});
