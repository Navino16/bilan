import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { env } from "@/env";
import { getAuth } from "@/server/auth";
import { GET, POST } from "@/app/api/auth/[...all]/route";

const email = `auth-route+${Date.now()}@bilan.local`;
const password = "auth-route-password-123";
const appUrl = env.APP_URL.replace(/\/$/, "");
let cookie = "";

beforeAll(async () => {
  const auth = await getAuth();
  await auth.api.signUpEmail({ body: { email, password, name: "Route" } });
  const res = await POST(
    new Request(`${appUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: appUrl },
      body: JSON.stringify({ email, password }),
    }),
  );
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
});

afterAll(async () => {
  const user = await db.user.findUnique({ where: { email } });
  if (user) await db.auditLog.deleteMany({ where: { userId: user.id } });
  await db.auditLog.deleteMany({ where: { metadata: { path: "$.email", equals: email } } });
  await db.user.deleteMany({ where: { email } });
  await db.$disconnect();
});

const get = (path: string) =>
  GET(new Request(`${appUrl}/api/auth${path}`, { headers: { cookie } }));

describe("/api/auth route (#243)", () => {
  it("keeps the session JSON out of caches", async () => {
    const res = await get("/get-session");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ user: { email } });
  });

  it("doesn't list the sessions and their tokens to the browser", async () => {
    expect((await get("/list-sessions")).status).toBe(404);
  });

  it("only revokes sessions through the Server Actions that purge trusted devices", async () => {
    for (const path of ["/revoke-session", "/revoke-sessions", "/revoke-other-sessions"]) {
      const res = await POST(
        new Request(`${appUrl}/api/auth${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: appUrl, cookie },
          body: JSON.stringify({ token: "x" }),
        }),
      );
      expect(res.status, path).toBe(404);
    }
    expect((await get("/get-session")).status).toBe(200);
  });
});
