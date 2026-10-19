import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { env } from "@/env";
import { getAuth } from "@/server/auth";

const email = `backup-race+${Date.now()}@bilan.local`;
const password = "backup-race-password-123";
const appUrl = env.APP_URL.replace(/\/$/, "");
let userId: string;
let backupCode: string;

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
      headers: { "content-type": "application/json", origin: appUrl, cookie },
      body: JSON.stringify(body),
    }),
  );
}

beforeAll(async () => {
  const auth = await getAuth();
  const api = auth.api as unknown as Api;
  userId = (await auth.api.signUpEmail({ body: { email, password, name: "Race" } })).user.id;
  const signedIn = await api.signInEmail({ body: { email, password }, asResponse: true });
  const { backupCodes } = await api.enableTwoFactor({
    body: { password },
    headers: new Headers({ cookie: cookieOf(signedIn) }),
  });
  backupCode = backupCodes[0];
  await db.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
  await db.twoFactor.updateMany({ where: { userId }, data: { verified: true } });
  await db.session.deleteMany({ where: { userId } });
});

afterAll(async () => {
  await db.auditLog.deleteMany({
    where: { OR: [{ userId }, { metadata: { path: "$.email", equals: email } }] },
  });
  await db.verification.deleteMany({ where: { value: userId } });
  await db.user.deleteMany({ where: { email } });
  await db.$disconnect();
});

describe("concurrent backup-code use (#243)", () => {
  it("lets one pending sign-in through and refuses the others", async () => {
    const pending: string[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await post("/sign-in/email", { email, password });
      expect(await res.json()).toMatchObject({ twoFactorRedirect: true });
      pending.push(cookieOf(res));
    }
    const results = await Promise.all(
      pending.map((cookie) => post("/two-factor/verify-backup-code", { code: backupCode }, cookie)),
    );
    // A loser that reads the consumed code gets a 401, one that loses the write a 409.
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s !== 200).every((s) => s === 401 || s === 409)).toBe(true);
    expect(await db.session.count({ where: { userId } })).toBe(1);
  });
});
