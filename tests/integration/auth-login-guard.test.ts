import { describe, it, expect, afterAll } from "vitest";
import { isAPIError } from "better-auth/api";
import { db } from "@/server/db";
import { getAuth } from "@/server/auth";

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
