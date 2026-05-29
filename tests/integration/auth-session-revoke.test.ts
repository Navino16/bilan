import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { getAuth } from "@/server/auth";

const email = `revoke+${Date.now()}@bilan.local`;
const password = "another-strong-password-12345";
let cookie: string;
let userId: string;

beforeAll(async () => {
  const auth = await getAuth();
  await auth.api.signUpEmail({ body: { email, password, name: "Revoke" } });
  // Sessions are cookie-based; capture the Set-Cookie from sign-in and replay
  // it so the revoke call is authenticated as this user.
  const res = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  userId = user.id;
});

afterAll(async () => {
  await db.user.deleteMany({ where: { email } });
  await db.$disconnect();
});

describe("session revoke", () => {
  it("revokes all sessions on logout-all", async () => {
    const auth = await getAuth();
    expect(await db.session.count({ where: { userId } })).toBeGreaterThanOrEqual(1);
    await auth.api.revokeSessions({ headers: new Headers({ cookie }) });
    const remaining = await db.session.findMany({ where: { userId } });
    expect(remaining.length).toBe(0);
  });
});
