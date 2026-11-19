import { createHash, randomBytes } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "@/server/db";
import { env } from "@/env";
import { getAuth } from "@/server/auth";
import { GET, POST } from "@/app/api/auth/[...all]/route";
import { appSettings } from "@/server/services/settings/app-settings";
import { oauthRegisterLimiter } from "@/server/auth/rate-limit";
import { mcpResourceUrl } from "@/server/mcp/oauth-config";
import { purgeStaleOAuthClients } from "@/server/mcp/oauth-grants";
import { snapshotSetting } from "./support/app-setting-snapshot";

const stamp = Date.now();
const tag = `oauth-provider-${stamp}`;
const appUrl = env.APP_URL.replace(/\/$/, "");
const loopback = "http://127.0.0.1:43123/callback";
const limitedIp = "198.51.100.21";
let userId: string;
let restoreSwitch: () => Promise<void>;

const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request(`${appUrl}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

const get = (path: string) => GET(new Request(`${appUrl}/api/auth${path}`));

function register(overrides: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return post(
    "/oauth2/register",
    {
      client_name: tag,
      redirect_uris: [loopback],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      ...overrides,
    },
    headers,
  );
}

async function registeredClientId(): Promise<string> {
  const res = await register();
  expect(res.status).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

function authorizeQuery(clientId: string, extra: Record<string, string> = {}): string {
  return new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: loopback,
    scope: "bilan:read offline_access",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "s",
    resource: mcpResourceUrl(),
    ...extra,
  }).toString();
}

beforeAll(async () => {
  const auth = await getAuth();
  userId = (
    await auth.api.signUpEmail({
      body: { email: `${tag}@bilan.local`, password: "oauth-provider-password-1", name: "OAuth" },
    })
  ).user.id;
  restoreSwitch = await snapshotSetting("mcp_enabled");
  await appSettings.set("mcp_enabled", true, userId);
});

afterEach(async () => {
  oauthRegisterLimiter.reset("unknown");
  oauthRegisterLimiter.reset(limitedIp);
  await appSettings.set("mcp_enabled", true, userId);
});

afterAll(async () => {
  await db.oauthClient.deleteMany({ where: { name: { startsWith: tag } } });
  await restoreSwitch();
  await db.auditLog.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
});

describe("OAuth provider over /api/auth (spec §5.18)", () => {
  it("registers a native loopback client without application_type, with no secret", async () => {
    const res = await register();
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.client_id).toEqual(expect.any(String));
    expect(body.client_secret).toBeUndefined();
  });

  it("registers an https web client", async () => {
    const res = await register({ redirect_uris: ["https://client.example/cb"] });
    expect(res.status).toBe(201);
  });

  it("refuses the client_credentials grant", async () => {
    const res = await register({ grant_types: ["client_credentials"] });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("sends a signed-out authorization to the Bilan consent page with a signed query", async () => {
    const clientId = await registeredClientId();
    const res = await get(`/oauth2/authorize?${authorizeQuery(clientId)}`);
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location.startsWith(`${appUrl}/oauth/consent?`)).toBe(true);
    expect(new URL(location).searchParams.get("sig")).toBeTruthy();
  });

  it("requires PKCE", async () => {
    const clientId = await registeredClientId();
    const query = new URLSearchParams(authorizeQuery(clientId));
    query.delete("code_challenge");
    query.delete("code_challenge_method");
    const res = await get(`/oauth2/authorize?${query}`);
    expect([302, 303]).toContain(res.status);
    const location = new URL(res.headers.get("location") ?? "");
    expect(`${location.origin}${location.pathname}`).toBe(loopback);
    expect(location.searchParams.get("error")).toBe("invalid_request");
  });

  it.each([
    ["POST", "/oauth2/consent"],
    ["POST", "/oauth2/continue"],
    ["POST", "/oauth2/create-client"],
    ["GET", "/oauth2/get-clients"],
    ["GET", "/oauth2/userinfo"],
    ["POST", "/oauth2/introspect"],
    ["GET", "/oauth2/public-client"],
    ["POST", "/admin/oauth2/create-client"],
    ["GET", `/admin/oauth2/resources/${encodeURIComponent("https://x.example/api")}`],
  ])("answers 404 to %s %s", async (method, path) => {
    const res = method === "GET" ? await get(path) : await post(path, {});
    expect(res.status).toBe(404);
  });

  it("hides the allowlisted endpoints while the instance switch is off", async () => {
    const clientId = await registeredClientId();
    await appSettings.set("mcp_enabled", false, userId);
    expect((await register()).status).toBe(404);
    expect((await get(`/oauth2/authorize?${authorizeQuery(clientId)}`)).status).toBe(404);
    const token = await POST(
      new Request(`${appUrl}/api/auth/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: "nope",
          client_id: clientId,
          redirect_uri: loopback,
          code_verifier: verifier,
        }),
      }),
    );
    expect(token.status).toBe(404);
  });

  it("limits registrations to 20 per IP and hour", async () => {
    const fromIp = { "x-forwarded-for": limitedIp };
    for (let i = 0; i < 20; i++) expect((await register({}, fromIp)).status).toBe(201);
    const res = await register({}, fromIp);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

describe("purgeStaleOAuthClients", () => {
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);
  const mkClient = (suffix: string, createdAt: Date) =>
    db.oauthClient.create({
      data: {
        id: `${tag}-${suffix}`,
        clientId: `${tag}-${suffix}`,
        name: `${tag}-${suffix}`,
        redirectUris: JSON.stringify([loopback]),
        createdAt,
        updatedAt: createdAt,
      },
    });

  it("deletes week-old clients nobody consented to and keeps the others", async () => {
    const stale = await mkClient("stale", daysAgo(8));
    const consented = await mkClient("consented", daysAgo(8));
    const fresh = await mkClient("fresh", daysAgo(1));
    await db.oauthConsent.create({
      data: {
        id: `${tag}-consent`,
        clientId: consented.clientId,
        userId,
        scopes: JSON.stringify(["bilan:read"]),
        createdAt: daysAgo(8),
        updatedAt: daysAgo(8),
      },
    });

    expect(await purgeStaleOAuthClients()).toBeGreaterThanOrEqual(1);

    const left = await db.oauthClient.findMany({
      where: { id: { in: [stale.id, consented.id, fresh.id] } },
      select: { id: true },
    });
    expect(left.map((c) => c.id).sort()).toEqual([consented.id, fresh.id].sort());
  });
});
