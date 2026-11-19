import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { appSettings } from "@/server/services/settings/app-settings";
import { setMcpEnabled } from "@/server/services/users/preferences";
import { mcpCallLimiter } from "@/server/auth/rate-limit";
import { handleMcpRequest } from "@/server/mcp/http";
import { mcpChallenge } from "@/server/mcp/discovery";
import { READ_TOOLS } from "@/server/mcp/tools/read";
import { MCP_TOKEN_PREFIX } from "@/server/mcp/tokens";
import { principalFromOAuthToken } from "@/server/mcp/oauth-principal";
import { resolveMcpPrincipal } from "@/server/mcp/principal";
import {
  OAUTH_ACCESS_TOKEN_PREFIX,
  OAUTH_REFRESH_TOKEN_PREFIX,
  mcpResourceUrl,
  oauthTokenHash,
} from "@/server/mcp/oauth-config";
import { snapshotSetting } from "./support/app-setting-snapshot";
import {
  authorize,
  consent,
  exchangeCode,
  refreshTokens,
  registerClient,
  signInCookie,
  type OAuthTokens,
} from "./support/oauth-flow";

const stamp = Date.now();
const tag = `oauth-principal-${stamp}`;
const email = `${tag}@bilan.local`;
const password = "oauth-principal-password-1";
let userId: string;
let cookie: string;
let restoreSwitch: () => Promise<void>;
const limiterKeys: string[] = [];

type Grant = { clientId: string; tokens: OAuthTokens; name: string };

async function grant(scope: string, consentScope?: string, session = cookie): Promise<Grant> {
  const name = `${tag}-${limiterKeys.length}-${Math.random().toString(36).slice(2, 8)}`;
  const { clientId, redirectUri } = await registerClient({ name });
  const { oauthQuery, verifier } = await authorize({
    clientId,
    redirectUri,
    cookie: session,
    scope,
  });
  const { code } = await consent({ oauthQuery, cookie: session, scope: consentScope });
  const tokens = await exchangeCode({ clientId, redirectUri, code, verifier });
  limiterKeys.push(`oauth:${clientId}:${userId}`);
  return { clientId, tokens, name };
}

const unprefixed = (token: string) => token.slice(OAUTH_ACCESS_TOKEN_PREFIX.length);
const accessRow = (token: string) => ({ token: oauthTokenHash(unprefixed(token)) });

const rpc = (body: unknown, token: string) =>
  handleMcpRequest(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    }),
  );
const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  },
};

beforeAll(async () => {
  const auth = await getAuth();
  userId = (await auth.api.signUpEmail({ body: { email, password, name: "OAuth Principal" } })).user
    .id;
  await setMcpEnabled(userId, true, "en");
  restoreSwitch = await snapshotSetting("mcp_enabled");
  await appSettings.set("mcp_enabled", true, userId);
  await db.bankAccount.create({
    data: { ownerId: userId, name: `${tag}-account`, type: "CHECKING" },
  });
  cookie = await signInCookie(email, password);
});

afterEach(async () => {
  for (const key of limiterKeys) mcpCallLimiter.reset(key);
  await db.user.update({ where: { id: userId }, data: { banned: false } });
  await setMcpEnabled(userId, true, "en");
  await appSettings.set("mcp_enabled", true, userId);
});

afterAll(async () => {
  await db.oauthClient.deleteMany({ where: { name: { startsWith: tag } } });
  await restoreSwitch();
  await db.bankAccount.deleteMany({ where: { ownerId: userId } });
  await db.auditLog.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
});

describe("OAuth tokens (spec §5.18)", () => {
  it("issues prefixed tokens and stores the hash of the unprefixed access token", async () => {
    const { tokens } = await grant("bilan:read offline_access");
    expect(tokens.access_token.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)).toBe(true);
    expect(tokens.refresh_token?.startsWith(OAUTH_REFRESH_TOKEN_PREFIX)).toBe(true);
    expect(
      await db.oauthAccessToken.findUnique({ where: accessRow(tokens.access_token) }),
    ).not.toBeNull();

    const { tokens: noRefresh } = await grant("bilan:read");
    expect(noRefresh.refresh_token).toBeUndefined();
  });

  it("resolves read and write grants into OAuth principals", async () => {
    const read = await grant("bilan:read");
    expect(await resolveMcpPrincipal(read.tokens.access_token)).toEqual({
      userId,
      scopes: ["bilan:read"],
      client: { kind: "oauth", id: read.clientId, name: read.name },
    });

    const write = await grant("bilan:write");
    expect(await resolveMcpPrincipal(write.tokens.access_token)).toMatchObject({
      scopes: ["bilan:read", "bilan:write"],
      client: { kind: "oauth", id: write.clientId },
    });
  });

  it("serves initialize, tools/list and tools/call over /api/mcp", async () => {
    const { tokens } = await grant("bilan:read");
    const init = await rpc(initialize, tokens.access_token);
    expect(init.status).toBe(200);
    expect((await init.json()).result.serverInfo.name).toBe("bilan");

    const list = await (
      await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, tokens.access_token)
    ).json();
    expect(list.result.tools.map((t: { name: string }) => t.name).sort()).toEqual(
      READ_TOOLS.map((t) => t.name).sort(),
    );

    const call = await (
      await rpc(
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "list_accounts", arguments: {} },
        },
        tokens.access_token,
      )
    ).json();
    expect(call.result.isError).toBeFalsy();
    expect(JSON.stringify(call.result.structuredContent)).toContain(`${tag}-account`);
  });

  it("outlives the browser session that created the grant", async () => {
    const { tokens } = await grant("bilan:read", undefined, await signInCookie(email, password));
    const { sessionId } = await db.oauthAccessToken.findUniqueOrThrow({
      where: accessRow(tokens.access_token),
    });
    expect(sessionId).toBeTruthy();
    await db.session.delete({ where: { id: sessionId! } });
    expect(await resolveMcpPrincipal(tokens.access_token)).toMatchObject({ userId });
  });

  it("rate-limits per client and user", async () => {
    const { clientId, tokens } = await grant("bilan:read");
    const key = `oauth:${clientId}:${userId}`;
    for (let i = 0; i < 120; i++) expect(mcpCallLimiter.consume(key).allowed).toBe(true);
    expect((await rpc(initialize, tokens.access_token)).status).toBe(429);
  });
});

describe("refused OAuth tokens", () => {
  it("refuses an expired token", async () => {
    const { tokens } = await grant("bilan:read");
    await db.oauthAccessToken.update({
      where: accessRow(tokens.access_token),
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await principalFromOAuthToken(tokens.access_token)).toBeNull();
  });

  it("refuses a revoked token", async () => {
    const { tokens } = await grant("bilan:read");
    await db.oauthAccessToken.update({
      where: accessRow(tokens.access_token),
      data: { revoked: new Date() },
    });
    expect(await principalFromOAuthToken(tokens.access_token)).toBeNull();
  });

  it("refuses a deleted token", async () => {
    const { tokens } = await grant("bilan:read");
    await db.oauthAccessToken.delete({ where: accessRow(tokens.access_token) });
    expect(await principalFromOAuthToken(tokens.access_token)).toBeNull();
  });

  it("refuses a token of a disabled client", async () => {
    const { clientId, tokens } = await grant("bilan:read");
    await db.oauthClient.update({ where: { clientId }, data: { disabled: true } });
    expect(await principalFromOAuthToken(tokens.access_token)).toBeNull();
  });

  it("refuses a banned user's token and accepts it again once unbanned", async () => {
    const { tokens } = await grant("bilan:read");
    await db.user.update({ where: { id: userId }, data: { banned: true } });
    expect(await principalFromOAuthToken(tokens.access_token)).toBeNull();
    await db.user.update({ where: { id: userId }, data: { banned: false } });
    expect(await principalFromOAuthToken(tokens.access_token)).not.toBeNull();
  });

  it("refuses the token while the user's switch is off and accepts it once back on", async () => {
    const { tokens } = await grant("bilan:read");
    await setMcpEnabled(userId, false, "en");
    expect(await principalFromOAuthToken(tokens.access_token)).toBeNull();
    await setMcpEnabled(userId, true, "en");
    expect(await principalFromOAuthToken(tokens.access_token)).not.toBeNull();
  });

  it("refuses the token while the instance switch is off", async () => {
    const { tokens } = await grant("bilan:read");
    await appSettings.set("mcp_enabled", false, userId);
    expect(await principalFromOAuthToken(tokens.access_token)).toBeNull();
  });

  it("refuses a token bound to another resource and accepts one without a resource", async () => {
    const { tokens } = await grant("bilan:read");
    const stored = await db.oauthAccessToken.findUniqueOrThrow({
      where: accessRow(tokens.access_token),
    });
    expect(stored.resources).toContain(mcpResourceUrl());

    await db.oauthAccessToken.update({
      where: accessRow(tokens.access_token),
      data: { resources: JSON.stringify(["https://elsewhere.example/api/mcp"]) },
    });
    expect(await principalFromOAuthToken(tokens.access_token)).toBeNull();
    const res = await rpc(initialize, tokens.access_token);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(mcpChallenge("invalid_token"));

    await db.oauthAccessToken.update({
      where: accessRow(tokens.access_token),
      data: { resources: null },
    });
    expect(await principalFromOAuthToken(tokens.access_token)).not.toBeNull();
  });

  it("never looks a PAT-prefixed string up as an OAuth token", async () => {
    const { tokens } = await grant("bilan:read");
    const disguised = MCP_TOKEN_PREFIX + unprefixed(tokens.access_token);
    expect(await principalFromOAuthToken(disguised)).toBeNull();
    expect(await resolveMcpPrincipal(disguised)).toBeNull();
    expect(await resolveMcpPrincipal(unprefixed(tokens.access_token))).toBeNull();
  });

  it("answers 403 insufficient_scope to a grant without a Bilan scope", async () => {
    const { tokens } = await grant("offline_access");
    expect(await resolveMcpPrincipal(tokens.access_token)).toBe("insufficient_scope");
    const res = await rpc(initialize, tokens.access_token);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "INSUFFICIENT_SCOPE" });
    expect(res.headers.get("www-authenticate")).toBe(mcpChallenge("insufficient_scope"));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("refresh and last use", () => {
  it("rotates the refresh token and refuses the old one, ending the family", async () => {
    const { clientId, tokens } = await grant("bilan:read offline_access");
    const refreshed = await refreshTokens({ clientId, refreshToken: tokens.refresh_token! });
    expect(refreshed.access_token).not.toBe(tokens.access_token);
    expect(refreshed.refresh_token).toBeDefined();
    expect(refreshed.refresh_token).not.toBe(tokens.refresh_token);
    expect(await resolveMcpPrincipal(refreshed.access_token)).toMatchObject({
      client: { kind: "oauth", id: clientId },
    });

    await expect(
      refreshTokens({ clientId, refreshToken: tokens.refresh_token! }),
    ).rejects.toThrow();
    expect(await resolveMcpPrincipal(refreshed.access_token)).toBeNull();
  });

  it("sets lastUsedAt on first use and leaves it alone within a minute", async () => {
    const { clientId, tokens } = await grant("bilan:read");
    const lastUsed = async () =>
      (await db.oauthConsent.findFirstOrThrow({ where: { userId, clientId } })).lastUsedAt;
    expect(await lastUsed()).toBeNull();

    await principalFromOAuthToken(tokens.access_token);
    const first = await lastUsed();
    expect(first).toBeInstanceOf(Date);

    await principalFromOAuthToken(tokens.access_token);
    expect(await lastUsed()).toEqual(first);

    const old = new Date(Date.now() - 120_000);
    await db.oauthConsent.updateMany({ where: { userId, clientId }, data: { lastUsedAt: old } });
    await principalFromOAuthToken(tokens.access_token);
    expect((await lastUsed())!.getTime()).toBeGreaterThan(old.getTime());
  });

  it("still resolves the token when the lastUsedAt update fails", async () => {
    const { tokens } = await grant("bilan:read");
    const update = vi
      .spyOn(db.oauthConsent, "updateMany")
      .mockRejectedValueOnce(new Error("db down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await principalFromOAuthToken(tokens.access_token)).toMatchObject({ userId });
      expect(log).toHaveBeenCalled();
    } finally {
      update.mockRestore();
      log.mockRestore();
    }
  });
});
