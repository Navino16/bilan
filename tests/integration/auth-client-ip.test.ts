import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

import { db } from "@/server/db";
import { env } from "@/env";
import { getAuth } from "@/server/auth";
import { CLIENT_IP_HEADER } from "@/server/http/client-ip";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/auth/[...all]/route";

const email = `client-ip+${Date.now()}@bilan.local`;
const password = "client-ip-strong-password";
const appUrl = env.APP_URL.replace(/\/$/, "");
let userId: string;

// Mirrors Next's proxyNextRequest (app-route module): route handlers get the NextRequest behind a
// Proxy, so undici can't read its private fields when it is passed to `new Request(...)`.
function asRouteRequest(url: string, init: ConstructorParameters<typeof NextRequest>[1]) {
  return new Proxy(new NextRequest(url, init), {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

beforeAll(async () => {
  const auth = await getAuth();
  userId = (await auth.api.signUpEmail({ body: { email, password, name: "Ip" } })).user.id;
  await db.session.deleteMany({ where: { userId } });
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { email } });
  await db.$disconnect();
});

describe("client IP behind the reverse proxy (#200)", () => {
  it("records the proxy-appended hop, not the client-forged ones", async () => {
    const res = await POST(
      asRouteRequest(`${appUrl}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: appUrl,
          "x-forwarded-for": "6.6.6.6, 203.0.113.50",
          [CLIENT_IP_HEADER]: "6.6.6.6",
        },
        body: JSON.stringify({ email, password }),
      }),
    );
    expect(res.status).toBe(200);
    const sessions = await db.session.findMany({ where: { userId }, select: { ipAddress: true } });
    expect(sessions).toEqual([{ ipAddress: "203.0.113.50" }]);
  });

  it("keeps the full IPv6 address, not Better Auth's /64 (#226)", async () => {
    await db.session.deleteMany({ where: { userId } });
    const res = await POST(
      asRouteRequest(`${appUrl}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: appUrl,
          "x-forwarded-for": "2001:db8:1:2::abcd",
        },
        body: JSON.stringify({ email, password }),
      }),
    );
    expect(res.status).toBe(200);
    const sessions = await db.session.findMany({ where: { userId }, select: { ipAddress: true } });
    expect(sessions).toEqual([{ ipAddress: "2001:db8:1:2::abcd" }]);
  });

  it("serves a GET from Next's proxied request", async () => {
    const res = await GET(asRouteRequest(`${appUrl}/api/auth/get-session`, { method: "GET" }));
    expect(res.status).toBe(200);
  });
});
