import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { symmetricDecrypt } from "better-auth/crypto";
import { isAPIError } from "better-auth/api";
import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { loginLimiter } from "@/server/auth/rate-limit";
import { loginLimiterKey } from "@/server/auth/login-guard";
import { hotp, totpStep } from "@/server/auth/totp-replay";

const email = `totp-replay+${Date.now()}@bilan.local`;
const password = "totp-replay-password-123";
let userId: string;
let secret: string;

type Api = {
  signInEmail(i: { body: object; asResponse: true }): Promise<Response>;
  enableTwoFactor(i: { body: { password: string }; headers: Headers }): Promise<unknown>;
  verifyTOTP(i: { body: { code: string }; headers: Headers; asResponse: true }): Promise<Response>;
};

async function api(): Promise<Api> {
  return (await getAuth()).api as unknown as Api;
}

function cookies(res: Response): Headers {
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return new Headers({ cookie });
}

async function signIn(): Promise<Headers> {
  loginLimiter.reset(loginLimiterKey(null, email));
  const res = await (await api()).signInEmail({ body: { email, password }, asResponse: true });
  expect(res.ok).toBe(true);
  return cookies(res);
}

type Verified = { status: number; code?: string; cookies?: Headers };

// Before-hook refusals are thrown even with asResponse.
async function verify(code: string, headers: Headers): Promise<Verified> {
  try {
    const res = await (await api()).verifyTOTP({ body: { code }, headers, asResponse: true });
    if (res.ok) return { status: res.status, cookies: cookies(res) };
    const body = (await res.json().catch(() => null)) as { code?: string } | null;
    return { status: res.status, code: body?.code };
  } catch (e) {
    if (isAPIError(e)) return { status: e.statusCode, code: e.body?.code };
    throw e;
  }
}

const reused = { status: 401, code: "INVALID_CODE" };

// Mid-step, so the ±1 window never straddles a boundary during the test.
const t0 = (totpStep(Date.now()) + 10) * 30_000 + 10_000;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(t0);
  const auth = await getAuth();
  userId = (await auth.api.signUpEmail({ body: { email, password, name: "Totp" } })).user.id;
  await (await api()).enableTwoFactor({ body: { password }, headers: await signIn() });
  const row = await db.twoFactor.findFirstOrThrow({ where: { userId } });
  secret = await symmetricDecrypt({ key: (await auth.$context).secretConfig, data: row.secret });
});

afterAll(async () => {
  vi.useRealTimers();
  await db.auditLog.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { email } });
  await db.$disconnect();
});

describe("TOTP replay guard (#223)", () => {
  it("accepts a code once, at enrolment and at sign-in, then the next step's code", async () => {
    const step = totpStep(t0);
    const enrolled = await verify(hotp(secret, step), await signIn());
    expect(enrolled.status).toBe(200);
    // Confirming enrolment rotates the session: replay with the new one.
    expect(await verify(hotp(secret, step), enrolled.cookies!)).toEqual(reused);

    const pending = await signIn();
    expect(await verify(hotp(secret, step), pending)).toEqual(reused);
    expect(
      await db.auditLog.count({
        where: {
          userId,
          action: "auth.login.failed",
          metadata: { path: "$.reason", equals: "CODE_REUSED" },
        },
      }),
    ).toBe(1);

    expect(await verify(hotp(secret, step - 1), pending)).toEqual(reused);

    vi.setSystemTime(t0 + 30_000);
    expect((await verify(hotp(secret, step + 1), pending)).status).toBe(200);
    expect((await db.twoFactor.findFirstOrThrow({ where: { userId } })).lastUsedStep).toBe(
      step + 1,
    );
  });

  it("accepts a code only once across two concurrent sign-ins", async () => {
    vi.setSystemTime(t0 + 60_000);
    const code = hotp(secret, totpStep(t0) + 2);
    const [p1, p2] = [await signIn(), await signIn()];
    const results = await Promise.all([verify(code, p1), verify(code, p2)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    expect(results.find((r) => r.status === 401)?.code).toBe("INVALID_CODE");
  });
});
