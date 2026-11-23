import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { getAuth } from "@/server/auth";

const email = `test+${Date.now()}@bilan.local`;
const password = "correct-horse-battery-staple";

beforeAll(async () => {
  await db.session.deleteMany();
  await db.userRole.deleteMany();
  await db.authAccount.deleteMany();
  await db.user.deleteMany({ where: { email } });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("auth signup + login", () => {
  it("creates a user via email/password signup", async () => {
    const auth = await getAuth();
    const res = await auth.api.signUpEmail({
      body: { email, password, name: "Test User" },
    });
    expect(res.user.email).toBe(email);
    const persisted = await db.user.findUnique({ where: { email } });
    expect(persisted).not.toBeNull();
  });

  it("logs in with the same credentials and returns a session token", async () => {
    const auth = await getAuth();
    const res = await auth.api.signInEmail({ body: { email, password } });
    expect(res.token).toBeDefined();
    const sessions = await db.session.findMany({ where: { user: { email } } });
    expect(sessions.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects a wrong password", async () => {
    const auth = await getAuth();
    await expect(auth.api.signInEmail({ body: { email, password: "wrong" } })).rejects.toThrow();
  });
});
