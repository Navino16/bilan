import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { changePasswordLimiter } from "@/server/auth/rate-limit";
import { appSettings } from "@/server/services/settings/app-settings";
import {
  RECENT_SIGN_IN_MS,
  STEP_UP_TTL_MS,
  confirmStepUp,
  stepUpMethod,
  stepUpVia,
} from "@/server/services/users/step-up";
import { snapshotSetting } from "./support/app-setting-snapshot";

vi.setConfig({ testTimeout: 20_000 });

const tag = `step-up-${Date.now()}`;
const email = `${tag}@bilan.local`;
const password = "step-up-password-123";
const ssoId = `${tag}-sso`;
const origin = { ipAddress: "203.0.113.7", userAgent: "Mozilla/5.0 Firefox/131.0" };
const target = { action: "test.step_up_failed", entity: "User" };

let userId: string;
let restoreCredentials: () => Promise<void>;
let seq = 0;

const stale = () => new Date(Date.now() - RECENT_SIGN_IN_MS - 60_000);
const session = (createdAt = stale()) => ({ id: `${tag}-s${seq++}`, userId, createdAt });
const failures = (reason: string) =>
  db.auditLog.findMany({
    where: { userId, action: target.action, metadata: { equals: { reason } } },
  });

beforeAll(async () => {
  restoreCredentials = await snapshotSetting("credentials_enabled");
  const auth = await getAuth();
  userId = (await auth.api.signUpEmail({ body: { email, password, name: "Step" } })).user.id;
  await db.user.create({ data: { id: ssoId, email: `${ssoId}@bilan.local` } });
});

beforeEach(async () => {
  changePasswordLimiter.reset(userId);
  await appSettings.set("credentials_enabled", true, userId);
});

afterAll(async () => {
  changePasswordLimiter.reset(userId);
  await restoreCredentials();
  await db.verification.deleteMany({ where: { value: { in: [userId, ssoId] } } });
  await db.auditLog.deleteMany({ where: { userId: { in: [userId, ssoId] } } });
  await db.user.deleteMany({ where: { id: { in: [userId, ssoId] } } });
  await db.$disconnect();
});

describe("step-up (#257)", () => {
  it("passes a recent sign-in and refuses an older session", async () => {
    expect(await stepUpVia(session(new Date()))).toBe("recent_sign_in");
    expect(await stepUpVia(session())).toBeNull();
  });

  it("asks for the password only while it can sign in", async () => {
    expect(await stepUpMethod(userId)).toBe("PASSWORD");
    expect(await stepUpMethod(ssoId)).toBe("SIGN_IN");
    await appSettings.set("credentials_enabled", false, userId);
    expect(await stepUpMethod(userId)).toBe("SIGN_IN");
    const s = session();
    expect(await confirmStepUp(s, password, target, origin)).toEqual({
      ok: false,
      error: "REAUTH_REQUIRED",
      method: "SIGN_IN",
    });
    expect(await stepUpVia(s)).toBeNull();
  });

  it("audits a wrong password with the request origin and grants nothing", async () => {
    const s = session();
    expect(await confirmStepUp(s, "wrong-password", target, origin)).toEqual({
      ok: false,
      error: "BAD_PASSWORD",
    });
    const [audit] = await failures("bad_password");
    expect(audit).toMatchObject({ entity: "User", ...origin });
    expect(await stepUpVia(s)).toBeNull();
  });

  it("grants the confirming session only, for a few minutes", async () => {
    const s = session();
    expect(await confirmStepUp(s, password, target, origin)).toEqual({ ok: true });
    expect(await stepUpVia(s)).toBe("password");
    expect(await stepUpVia(session())).toBeNull();
    expect(await stepUpVia(s, new Date(Date.now() + STEP_UP_TTL_MS + 1000))).toBeNull();

    expect(await confirmStepUp(s, password, target, origin)).toEqual({ ok: true });
    const grants = await db.verification.count({ where: { identifier: `step-up-${s.id}` } });
    expect(grants).toBe(1);
  });

  it("rate-limits wrong passwords and audits the refusal once per window", async () => {
    const s = session();
    for (let i = 0; i < 5; i++) await confirmStepUp(s, "wrong-password", target, origin);
    for (let i = 0; i < 3; i++) {
      expect(await confirmStepUp(s, password, target, origin)).toMatchObject({
        ok: false,
        error: "RATE_LIMITED",
      });
    }
    expect(await failures("rate_limit")).toHaveLength(1);
    expect(await stepUpVia(s)).toBeNull();
  });
});
