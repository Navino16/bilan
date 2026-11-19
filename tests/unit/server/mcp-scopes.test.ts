import { describe, it, expect } from "vitest";
import { z } from "zod";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { buildMcpServer, hasScope } from "@/server/mcp/server";
import { oauthScopesToMcp } from "@/server/mcp/oauth-principal";
import { READ_TOOLS, type McpTool } from "@/server/mcp/tools/read";
import type { McpPrincipal } from "@/server/mcp/context";

const principal = (scopes: McpPrincipal["scopes"]): McpPrincipal => ({
  userId: "u1",
  scopes,
  client: { kind: "oauth", id: "c1", name: "Client" },
});

const fakeWriteTool: McpTool = {
  name: "fake_write",
  description: "Writes something.",
  scope: "bilan:write",
  annotations: { readOnlyHint: false },
  input: z.object({}),
  categoryPaths: false,
  run: async () => ({}),
};

async function listedTools(p: McpPrincipal): Promise<string[]> {
  const server = buildMcpServer(p, [...READ_TOOLS, fakeWriteTool]);
  const client = new Client({ name: "bilan-test", version: "1.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  await client.connect(clientSide);
  try {
    return (await client.listTools()).tools.map((t) => t.name);
  } finally {
    await client.close();
    await server.close();
  }
}

describe("oauthScopesToMcp", () => {
  it.each([
    [["bilan:write"], ["bilan:read", "bilan:write"]],
    [
      ["bilan:read", "bilan:write", "offline_access"],
      ["bilan:read", "bilan:write"],
    ],
    [["bilan:read"], ["bilan:read"]],
    [["bilan:read", "offline_access"], ["bilan:read"]],
    [["offline_access"], []],
    [[], []],
  ])("maps %j to %j", (scopes, expected) => {
    expect(oauthScopesToMcp(scopes)).toEqual(expected);
  });
});

describe("hasScope", () => {
  it("lets write imply read but not the other way round", () => {
    expect(hasScope({ scopes: ["bilan:read"] }, "bilan:write")).toBe(false);
    expect(hasScope({ scopes: ["bilan:read", "bilan:write"] }, "bilan:read")).toBe(true);
    expect(hasScope({ scopes: ["bilan:write"] }, "bilan:read")).toBe(true);
  });
});

describe("buildMcpServer", () => {
  it("never lists a bilan:write tool to a read principal", async () => {
    const names = await listedTools(principal(["bilan:read"]));
    expect(names).not.toContain("fake_write");
    expect(names.sort()).toEqual(READ_TOOLS.map((t) => t.name).sort());
  });

  it("lists the bilan:write tool to a write principal", async () => {
    expect(await listedTools(principal(["bilan:read", "bilan:write"]))).toContain("fake_write");
  });
});
