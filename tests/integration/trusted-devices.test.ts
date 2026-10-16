import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { db } from "@/server/db";
import { env } from "@/env";
import { getAuth } from "@/server/auth";
import {
  listTrustedDevices,
  revokeAllTrustedDevices,
  revokeTrustedDevice,
} from "@/server/services/users/trusted-devices";

const stamp = Date.now();
const email = `trusted+${stamp}@bilan.local`;
const otherEmail = `trusted-other+${stamp}@bilan.local`;
const password = "trusted-devices-password-123";
const appUrl = env.APP_URL.replace(/\/$/, "");
const firefoxUa = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
let userId: string;
let otherId: string;
let backupCodes: string[];

type Api = {
  signInEmail(i: { body: object; asResponse: true }): Promise<Response>;
  enableTwoFactor(i: {
    body: { password: string };
    headers: Headers;
  }): Promise<{ backupCodes: string[] }>;
};

function cookieOf(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

async function post(path: string, body: object, cookie = ""): Promise<Response> {
  const auth = await getAuth();
  return auth.handler(
    new Request(`${appUrl}/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: appUrl,
        cookie,
        "user-agent": firefoxUa,
      },
      body: JSON.stringify(body),
    }),
  );
}

// Password + backup code with "trust this device": returns the browser's cookies.
async function signInTrusted(code: string): Promise<{ cookie: string; sessionId: string }> {
  const pending = await post("/sign-in/email", { email, password });
  const verified = await post(
    "/two-factor/verify-backup-code",
    { code, trustDevice: true },
    cookieOf(pending),
  );
  expect(verified.status).toBe(200);
  const cookie = cookieOf(verified);
  const session = await (await getAuth()).api.getSession({ headers: new Headers({ cookie }) });
  return { cookie, sessionId: session!.session.id };
}

const grants = (value: string) =>
  db.verification.findMany({
    where: { value, identifier: { startsWith: "trust-device-" } },
    select: { id: true },
  });

beforeAll(async () => {
  const auth = await getAuth();
  const api = auth.api as unknown as Api;
  userId = (await auth.api.signUpEmail({ body: { email, password, name: "Trusted" } })).user.id;
  otherId = (await auth.api.signUpEmail({ body: { email: otherEmail, password, name: "Other" } }))
    .user.id;
  const signedIn = await api.signInEmail({ body: { email, password }, asResponse: true });
  ({ backupCodes } = await api.enableTwoFactor({
    body: { password },
    headers: new Headers({ cookie: cookieOf(signedIn) }),
  }));
  await db.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
  await db.twoFactor.updateMany({ where: { userId }, data: { verified: true } });
});

beforeEach(async () => {
  await db.verification.deleteMany({ where: { value: { in: [userId, otherId] } } });
  await db.session.deleteMany({ where: { userId } });
});

afterAll(async () => {
  await db.auditLog.deleteMany({
    where: {
      OR: [{ userId: { in: [userId, otherId] } }, { metadata: { path: "$.email", equals: email } }],
    },
  });
  await db.verification.deleteMany({ where: { value: { in: [userId, otherId] } } });
  await db.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  await db.$disconnect();
});

describe("listTrustedDevices (#256)", () => {
  it("lists a trusted browser with its sign-in's device, and follows the grant's rotation", async () => {
    const first = await signInTrusted(backupCodes[0]);
    const [listed] = await listTrustedDevices(userId, first.sessionId);
    expect(listed).toMatchObject({ browser: "Firefox", os: "Linux", mobile: false, current: true });
    expect(listed.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000);

    // A later password sign-in from the trusted browser skips the code and replaces the grant.
    const again = await post("/sign-in/email", { email, password }, first.cookie);
    expect(await again.json()).not.toHaveProperty("twoFactorRedirect");
    const after = await listTrustedDevices(userId, null);
    expect(after).toHaveLength(1);
    expect(after[0].id).not.toBe(listed.id);
    expect(after[0]).toMatchObject({ browser: "Firefox", current: false });
  });

  it("leaves out expired grants and other users' grants; a grant without a session has no device", async () => {
    const now = new Date();
    const later = new Date(now.getTime() + 86_400_000);
    await db.verification.createMany({
      data: [
        {
          id: `tdl_${stamp}`,
          identifier: `trust-device-l${stamp}`,
          value: userId,
          expiresAt: later,
        },
        {
          id: `tde_${stamp}`,
          identifier: `trust-device-e${stamp}`,
          value: userId,
          expiresAt: new Date(now.getTime() - 1000),
        },
        {
          id: `tdo_${stamp}`,
          identifier: `trust-device-o${stamp}`,
          value: otherId,
          expiresAt: later,
        },
      ],
    });
    expect(await listTrustedDevices(userId, null, now)).toEqual([
      expect.objectContaining({ id: `tdl_${stamp}`, browser: null, os: null, current: false }),
    ]);
  });
});

describe("revoking trusted devices (#256)", () => {
  it("forgets one of the user's devices: its next sign-in asks for the code again", async () => {
    const { cookie } = await signInTrusted(backupCodes[1]);
    const [device] = await listTrustedDevices(userId, null);
    expect(await revokeTrustedDevice(userId, device.id)).toEqual({ ok: true });
    expect(await grants(userId)).toEqual([]);
    const again = await post("/sign-in/email", { email, password }, cookie);
    expect(await again.json()).toMatchObject({ twoFactorRedirect: true });
    const audit = await db.auditLog.findFirst({
      where: { userId, action: "auth.trusted_device.revoked" },
    });
    expect(audit).toMatchObject({ entity: "TrustedDevice", entityId: device.id });
  });

  it("refuses another user's grant or an unknown id", async () => {
    const expiresAt = new Date(Date.now() + 86_400_000);
    await db.verification.create({
      data: { id: `tdx_${stamp}`, identifier: `trust-device-x${stamp}`, value: otherId, expiresAt },
    });
    expect(await revokeTrustedDevice(userId, `tdx_${stamp}`)).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect(await revokeTrustedDevice(userId, "missing")).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await grants(otherId)).toHaveLength(1);
  });

  it("forgets every device of the user only, and audits the count", async () => {
    const expiresAt = new Date(Date.now() + 86_400_000);
    await db.verification.createMany({
      data: [userId, userId, otherId].map((value, i) => ({
        id: `tda${i}_${stamp}`,
        identifier: `trust-device-a${i}${stamp}`,
        value,
        expiresAt,
      })),
    });
    expect(await revokeAllTrustedDevices(userId)).toEqual({ count: 2 });
    expect(await grants(userId)).toEqual([]);
    expect(await grants(otherId)).toHaveLength(1);
    const audit = await db.auditLog.findFirst({
      where: { userId, action: "auth.trusted_device.revoked_all" },
    });
    expect(audit?.metadata).toEqual({ count: 2 });

    expect(await revokeAllTrustedDevices(userId)).toEqual({ count: 0 });
    expect(
      await db.auditLog.count({ where: { userId, action: "auth.trusted_device.revoked_all" } }),
    ).toBe(1);
  });
});
