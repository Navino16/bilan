import { describe, it, expect, afterAll } from "vitest";
import { isAPIError } from "better-auth/api";
import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { env } from "@/env";
import { CLIENT_IP_HEADER } from "@/server/http/client-ip";
import { loginAccountLimiter } from "@/server/auth/rate-limit";
import { POST } from "@/app/api/auth/[...all]/route";

// Direct Better Auth calls (like POST /api/auth/sign-in/email) must get the same
// per-email limiting and audit as the login Server Action.
const password = "guard-strong-password-1";
const emails: string[] = [];

async function newUser(label: string): Promise<{ id: string; email: string }> {
  const email = `guard-${label}+${Date.now()}@bilan.local`;
  emails.push(email);
  const auth = await getAuth();
  const res = await auth.api.signUpEmail({ body: { email, password, name: "Guard" } });
  return { id: res.user.id, email };
}

async function attempt(email: string, pw: string): Promise<string> {
  const auth = await getAuth();
  try {
    const res = await auth.api.signInEmail({ body: { email, password: pw } });
    return "twoFactorRedirect" in res && res.twoFactorRedirect ? "2FA" : "OK";
  } catch (e) {
    return isAPIError(e) ? String(e.body?.code) : "THROWN";
  }
}

const appUrl = env.APP_URL.replace(/\/$/, "");

async function post(path: string, body: object, headers: Record<string, string>) {
  const auth = await getAuth();
  return auth.handler(
    new Request(`${appUrl}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: appUrl, ...headers },
      body: JSON.stringify(body),
    }),
  );
}

const auditFor = (email: string) =>
  db.auditLog.findMany({
    where: { metadata: { path: "$.email", equals: email } },
    select: { action: true, metadata: true },
  });

afterAll(async () => {
  await db.auditLog.deleteMany({
    where: { OR: emails.map((email) => ({ metadata: { path: "$.email", equals: email } })) },
  });
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.$disconnect();
});

describe("login guard", () => {
  it("clears failures on a successful sign-in", async () => {
    const { email } = await newUser("reset");
    for (let i = 0; i < 4; i++)
      expect(await attempt(email, "wrong-password-123")).not.toBe("RATE_LIMITED");
    expect(await attempt(email, password)).toBe("OK");
    for (let i = 0; i < 4; i++)
      expect(await attempt(email, "wrong-password-123")).not.toBe("RATE_LIMITED");
    expect(await attempt(email, password)).toBe("OK");
    const actions = (await auditFor(email)).map((a) => a.action);
    expect(actions.filter((a) => a === "auth.login.success")).toHaveLength(2);
    expect(actions.filter((a) => a === "auth.login.failed")).toHaveLength(8);
  });

  it("blocks the email after five failures, even with the right password", async () => {
    const { email } = await newUser("block");
    for (let i = 0; i < 5; i++) await attempt(email, "wrong-password-123");
    expect(await attempt(email, password)).toBe("RATE_LIMITED");
    const blocked = (await auditFor(email)).find(
      (a) => (a.metadata as { reason?: string }).reason === "RATE_LIMITED",
    );
    expect(blocked?.action).toBe("auth.login.failed");
  });

  it("can't be raced with parallel attempts", async () => {
    const { email } = await newUser("race");
    await Promise.all(Array.from({ length: 10 }, () => attempt(email, "wrong-password-123")));
    expect(await attempt(email, password)).toBe("RATE_LIMITED");
  });

  it("limits per client IP and account, with a Retry-After header on the 429 (#243)", async () => {
    const { email } = await newUser("ip");
    const signIn = (ip: string, pw: string) =>
      post("/sign-in/email", { email, password: pw }, { [CLIENT_IP_HEADER]: ip });
    for (let i = 0; i < 5; i++) {
      expect((await signIn("203.0.113.7", "wrong-password-123")).status).toBe(401);
    }
    const blocked = await signIn("203.0.113.7", password);
    expect(blocked.status).toBe(429);
    const retryAfter = Number(blocked.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(15 * 60);
    expect(await blocked.json()).toMatchObject({ code: "RATE_LIMITED", retryAfter });

    expect((await signIn("198.51.100.4", password)).status).toBe(200);
    expect(await attempt(email, password)).toBe("OK");
  });

  it("caps wrong passwords per account whatever the client IP (#243)", async () => {
    const { email } = await newUser("rotate");
    for (let i = 0; i < 28; i++) loginAccountLimiter.consume(email);
    const fromIp = (n: number, pw: string) =>
      POST(
        new Request(`${appUrl}/api/auth/sign-in/email`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: appUrl,
            "x-forwarded-for": `198.51.100.${n}`,
          },
          body: JSON.stringify({ email, password: pw }),
        }),
      );
    expect((await fromIp(1, "wrong-password-123")).status).toBe(401);
    expect((await fromIp(2, "wrong-password-123")).status).toBe(401);
    const blocked = await fromIp(3, password);
    expect(blocked.status).toBe(429);
    const retryAfter = Number(blocked.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(15 * 60);
    expect(retryAfter).toBeLessThanOrEqual(60 * 60);
    expect(await blocked.json()).toMatchObject({ code: "RATE_LIMITED", retryAfter });
  });

  it("doesn't count right passwords against the per-account cap", async () => {
    const { email } = await newUser("account-ok");
    for (let i = 0; i < 29; i++) loginAccountLimiter.consume(email);
    expect(await attempt(email, password)).toBe("OK");
    expect(await attempt(email, "wrong-password-123")).toBe("INVALID_EMAIL_OR_PASSWORD");
    expect(await attempt(email, password)).toBe("RATE_LIMITED");
  });

  it("audits a 2FA password step as pending, not as a sign-in, and keeps it counted", async () => {
    const { id, email } = await newUser("twofa");
    await db.user.update({ where: { id }, data: { twoFactorEnabled: true } });
    for (let i = 0; i < 5; i++) expect(await attempt(email, password)).toBe("2FA");
    expect(await attempt(email, password)).toBe("RATE_LIMITED");
    const actions = (await auditFor(email)).map((a) => a.action);
    expect(actions.filter((a) => a === "auth.login.2fa_pending")).toHaveLength(5);
    expect(actions).not.toContain("auth.login.success");
  });
});
