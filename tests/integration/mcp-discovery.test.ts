import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { appSettings } from "@/server/services/settings/app-settings";
import { handleMcpRequest } from "@/server/mcp/http";
import { MCP_OAUTH_SCOPES, mcpResourceUrl, oauthIssuer } from "@/server/mcp/oauth-config";
import { mcpChallenge } from "@/server/mcp/discovery";
import {
  GET as prmGet,
  OPTIONS as prmOptions,
} from "@/app/.well-known/oauth-protected-resource/[[...path]]/route";
import {
  GET as asGet,
  OPTIONS as asOptions,
} from "@/app/.well-known/oauth-authorization-server/[[...path]]/route";
import { snapshotSetting } from "./support/app-setting-snapshot";

const stamp = Date.now();
let userId: string;
let restore: () => Promise<void>;

const call = (get: typeof prmGet, path: string[] | undefined) =>
  get(new Request("http://localhost/.well-known/x"), { params: Promise.resolve({ path }) });

beforeAll(async () => {
  const auth = await getAuth();
  userId = (
    await auth.api.signUpEmail({
      body: {
        email: `mcpdisc+${stamp}@bilan.local`,
        password: "original-strong-password-1",
        name: "Mcp Discovery",
      },
    })
  ).user.id;
  restore = await snapshotSetting("mcp_enabled");
  await appSettings.set("mcp_enabled", true, userId);
});

afterAll(async () => {
  await restore();
  await db.user.deleteMany({ where: { id: userId } });
});

describe("protected resource metadata", () => {
  it.each([[undefined], [["api", "mcp"]]])("is served at %j", async (path) => {
    const res = await call(prmGet, path);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resource).toBe(mcpResourceUrl());
    expect(body.authorization_servers).toEqual([oauthIssuer()]);
    expect(body.scopes_supported).toEqual([...MCP_OAUTH_SCOPES]);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("authorization server metadata", () => {
  it.each([[undefined], [["api", "auth"]]])("is served at %j", async (path) => {
    const res = await call(asGet, path);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.issuer).toBe(oauthIssuer());
    for (const key of ["authorization_endpoint", "token_endpoint", "registration_endpoint"]) {
      expect(body[key]).toMatch(new RegExp(`^${oauthIssuer()}/oauth2/`));
    }
    expect(body.code_challenge_methods_supported).toContain("S256");
    expect(body.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
    expect(body.token_endpoint_auth_methods_supported).toContain("none");
    expect(Object.keys(body).filter((k) => k.startsWith("introspection_endpoint"))).toEqual([]);
    expect(body).not.toHaveProperty("userinfo_endpoint");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("CORS preflight", () => {
  it.each([[prmOptions], [asOptions]])("allows a cross-origin GET", async (options) => {
    const res = await options();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET");
    expect(res.headers.get("access-control-allow-headers")).toBe("*");
  });
});

describe("unknown suffixes and the instance switch", () => {
  it.each([
    [prmGet, ["api", "other"]],
    [asGet, ["api", "other"]],
  ])("answers 404 for another suffix", async (get, path) => {
    expect((await call(get, path)).status).toBe(404);
  });

  it("answers 404 on all four documents when the instance switch is off", async () => {
    await appSettings.set("mcp_enabled", false, userId);
    try {
      for (const [get, path] of [
        [prmGet, undefined],
        [prmGet, ["api", "mcp"]],
        [asGet, undefined],
        [asGet, ["api", "auth"]],
      ] as const) {
        expect((await call(get, path as string[] | undefined)).status).toBe(404);
      }
    } finally {
      await appSettings.set("mcp_enabled", true, userId);
    }
  });
});

describe("401 challenge", () => {
  const post = (token?: string) =>
    handleMcpRequest(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: "{}",
      }),
    );

  it("advertises the resource metadata without a token", async () => {
    const res = await post();
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(mcpChallenge());
  });

  it("adds invalid_token for a presented bad token", async () => {
    const res = await post("nope");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(mcpChallenge("invalid_token"));
  });
});
