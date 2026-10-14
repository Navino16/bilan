import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => request.headers,
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { changePasswordLimiter } from "@/server/auth/rate-limit";
import { changePasswordAction } from "@/server/transport/actions/auth";
import {
  disableTwoFactorAction,
  enableTwoFactorAction,
} from "@/server/transport/actions/two-factor";

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

const audits = (action: string, reason: string) =>
  db.auditLog.count({ where: { userId, action, metadata: { equals: { reason } } } });

beforeAll(async () => {
  const auth = await getAuth();
  userId = (await auth.api.signUpEmail({ body: { email, password, name: "Tfa" } })).user.id;
});

beforeEach(async () => {
  changePasswordLimiter.reset(userId);
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
    expect(await disableTwoFactorAction("wrong-password")).toEqual({
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

  it("disables two-factor with the right password and audits it", async () => {
    await db.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
    expect(await disableTwoFactorAction(password)).toEqual({ ok: true, data: null });
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.twoFactorEnabled).toBe(false);
    expect(await db.twoFactor.count({ where: { userId } })).toBe(0);
    expect(await db.auditLog.count({ where: { userId, action: "auth.2fa.disabled" } })).toBe(1);
  });

  it("redirects to the login page without a session, without checking the password", async () => {
    request.headers = new Headers();
    await expect(enableTwoFactorAction(password)).rejects.toThrow("NEXT_REDIRECT");
    await expect(disableTwoFactorAction(password)).rejects.toThrow("NEXT_REDIRECT");
    expect(changePasswordLimiter.consume(userId)).toMatchObject({ allowed: true });
  });

  it("shares the per-user password limiter with change-password and audits it", async () => {
    for (let i = 0; i < 5; i++) changePasswordLimiter.consume(userId);
    const res = await enableTwoFactorAction(password);
    expect(res).toMatchObject({ ok: false, error: "RATE_LIMITED" });
    if (!res.ok) expect(res.retryAfter).toBeGreaterThan(0);
    expect(await disableTwoFactorAction(password)).toMatchObject({ error: "RATE_LIMITED" });
    expect(await audits("auth.2fa.enable_failed", "rate_limit")).toBe(1);
    expect(await audits("auth.2fa.disable_failed", "rate_limit")).toBe(1);
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
      expect(await disableTwoFactorAction("wrong-password")).toMatchObject({
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

  it("only counts wrong passwords from the 2FA settings", async () => {
    for (let i = 0; i < 4; i++) changePasswordLimiter.consume(userId);
    await db.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
    expect(await disableTwoFactorAction(password)).toEqual({ ok: true, data: null });
    await signIn();
    expect(await disableTwoFactorAction("wrong-password")).toEqual({
      ok: false,
      error: "BAD_PASSWORD",
    });
    expect(await disableTwoFactorAction("wrong-password")).toMatchObject({
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
