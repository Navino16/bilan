import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { z } from "zod";
import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import { mcpWriteLimiter } from "@/server/auth/rate-limit";
import { runAsMcp, type McpPrincipal } from "@/server/mcp/context";
import { buildMcpServer } from "@/server/mcp/server";
import { READ_TOOLS } from "@/server/mcp/tools/read";
import { writeTool } from "@/server/mcp/tools/write-tool";

const userId = "mcpwinfra_user";
const principal = (scopes: McpPrincipal["scopes"], id = "a"): McpPrincipal => ({
  userId,
  scopes,
  client: { kind: "token", id: `tok_${id}`, name: "Test client" },
});

const testWrite = writeTool({
  name: "test_write",
  description: "Test only.",
  input: z.object({}),
  run: async (uid) => {
    await logEvent({ userId: uid, action: "test.write" });
    return { ok: true };
  },
});

async function connect(p: McpPrincipal) {
  const server = buildMcpServer(p, [...READ_TOOLS, testWrite]);
  const client = new Client({ name: "bilan-test", version: "1.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  await client.connect(clientSide);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

const auditRows = (action: string) => db.auditLog.findMany({ where: { userId, action } });
const textOf = (r: Awaited<ReturnType<Client["callTool"]>>) =>
  (r.content as { type: string; text: string }[]).map((c) => c.text).join(" ");

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: userId } });
  await db.user.create({ data: { id: userId, email: `${userId}@bilan.local`, name: "W" } });
});

afterEach(async () => {
  mcpWriteLimiter.reset(`token:tok_a`);
  mcpWriteLimiter.reset(`token:tok_b`);
  await db.auditLog.deleteMany({ where: { userId } });
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

describe("audit stamp", () => {
  it("stamps MCP calls with via and client, and keeps the caller's metadata", async () => {
    const p = principal(["bilan:write"]);
    await runAsMcp(p, () => logEvent({ userId, action: "test.in", metadata: { custom: 1 } }));
    await logEvent({ userId, action: "test.out", metadata: { custom: 2 } });
    const [inside] = await auditRows("test.in");
    const [outside] = await auditRows("test.out");
    expect(inside.metadata).toEqual({ custom: 1, via: "mcp", client: p.client });
    expect(outside.metadata).toEqual({ custom: 2 });
  });
});

describe("write tools", () => {
  it("hides write tools from a read principal and refuses the call", async () => {
    const c = await connect(principal(["bilan:read"]));
    const names = (await c.client.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain("test_write");
    await expect(c.client.callTool({ name: "test_write", arguments: {} })).rejects.toThrow(
      /not found/,
    );
    expect(await auditRows("test.write")).toHaveLength(0);
    await c.close();
  });

  it("limits write calls to 30 a minute per client, reads and other tokens unaffected", async () => {
    const c = await connect(principal(["bilan:write"]));
    for (let i = 0; i < 30; i++) {
      const res = await c.client.callTool({ name: "test_write", arguments: {} });
      expect(res.isError).toBeFalsy();
    }
    const refused = await c.client.callTool({ name: "test_write", arguments: {} });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain("RATE_LIMITED");
    expect(await auditRows("test.write")).toHaveLength(30);

    const read = await c.client.callTool({ name: "list_accounts", arguments: {} });
    expect(read.isError).toBeFalsy();

    const other = await connect(principal(["bilan:write"], "b"));
    const ok = await other.client.callTool({ name: "test_write", arguments: {} });
    expect(ok.isError).toBeFalsy();
    await other.close();
    await c.close();
  });
});
