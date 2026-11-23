import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { appSettings } from "@/server/services/settings/app-settings";
import { setMcpEnabled } from "@/server/services/users/preferences";
import { createMcpToken, revokeMcpToken } from "@/server/mcp/tokens";
import { mcpChallenge } from "@/server/mcp/discovery";
import { handleMcpRequest } from "@/server/mcp/http";
import { mcpCallLimiter } from "@/server/auth/rate-limit";
import { READ_TOOLS } from "@/server/mcp/tools/read";

const stamp = Date.now();
const email = `mcproute+${stamp}@bilan.local`;
let userId: string;

const rpc = (body: unknown, token?: string) =>
  handleMcpRequest(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
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
const tokenIds: string[] = [];
const mk = async () => {
  const created = await createMcpToken(userId, { name: "t", scope: "read" });
  tokenIds.push(created.id);
  return created;
};

beforeAll(async () => {
  const auth = await getAuth();
  userId = (
    await auth.api.signUpEmail({
      body: { email, password: "original-strong-password-1", name: "Mcp Route" },
    })
  ).user.id;
  await setMcpEnabled(userId, true, "en");
  await appSettings.set("mcp_enabled", true, userId);
});

afterEach(async () => {
  for (const id of tokenIds.splice(0)) mcpCallLimiter.reset(`token:${id}`);
  await db.mcpToken.deleteMany({ where: { userId } });
  await appSettings.set("mcp_enabled", true, userId);
  await setMcpEnabled(userId, true, "en");
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: userId } });
});

describe("/api/mcp", () => {
  it("answers 404 when the instance switch is off", async () => {
    const { token } = await mk();
    await appSettings.set("mcp_enabled", false, userId);
    const res = await rpc(initialize, token);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "NOT_FOUND" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it.each([["none"], ["nope"]])("answers 401 with a challenge for %s", async (kind) => {
    const res = await rpc(initialize, kind === "none" ? undefined : "nope");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      mcpChallenge(kind === "none" ? undefined : "invalid_token"),
    );
    expect(await res.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 401 for a revoked token and for a user who opted out", async () => {
    const created = await createMcpToken(userId, { name: "r", scope: "read" });
    await revokeMcpToken(userId, created.id);
    expect((await rpc(initialize, created.token)).status).toBe(401);
    const { token } = await mk();
    await setMcpEnabled(userId, false, "en");
    expect((await rpc(initialize, token)).status).toBe(401);
  });

  it("serves initialize, tools/list and tools/call end to end", async () => {
    const { token } = await mk();
    const init = await rpc(initialize, token);
    expect(init.status).toBe(200);
    expect(init.headers.get("cache-control")).toBe("no-store");
    const initBody = await init.json();
    expect(initBody.result.serverInfo.name).toBe("bilan");

    const list = await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, token)).json();
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
        token,
      )
    ).json();
    expect(call.result.isError).toBeFalsy();
    expect(call.result.structuredContent).toBeDefined();
  });

  it("answers 429 with Retry-After past 120 calls a minute", async () => {
    const { token, id } = await mk();
    for (let i = 0; i < 120; i++) expect(mcpCallLimiter.consume(`token:${id}`).allowed).toBe(true);
    const res = await rpc(initialize, token);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it.each(["GET", "DELETE"])("answers 405 to %s without opening a stream", async (method) => {
    const { token } = await mk();
    const res = await handleMcpRequest(
      new Request("http://localhost/api/mcp", {
        method,
        headers: { accept: "text/event-stream", authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect(await res.json()).toEqual({ error: "METHOD_NOT_ALLOWED" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 404 before 405 when the instance is off", async () => {
    await appSettings.set("mcp_enabled", false, userId);
    const res = await handleMcpRequest(new Request("http://localhost/api/mcp", { method: "GET" }));
    expect(res.status).toBe(404);
  });

  it("answers 401 for a banned user and for an expired token", async () => {
    const { token } = await mk();
    await db.user.update({ where: { id: userId }, data: { banned: true } });
    expect((await rpc(initialize, token)).status).toBe(401);
    await db.user.update({ where: { id: userId }, data: { banned: false } });
    const expired = await mk();
    await db.mcpToken.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await rpc(initialize, expired.token)).status).toBe(401);
  });

  it("answers a JSON-RPC parse error for a malformed body", async () => {
    const { token } = await mk();
    const res = await handleMcpRequest(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${token}`,
        },
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe(-32700);
  });

  it("answers a JSON 500 without details when something throws", async () => {
    const spy = vi.spyOn(appSettings, "get").mockRejectedValueOnce(new Error("secret db detail"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await rpc(initialize, "x");
    spy.mockRestore();
    log.mockRestore();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "INTERNAL" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
