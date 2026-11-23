import { describe, it, expect } from "vitest";
import {
  aiShareWhere,
  currentMcpPrincipal,
  runAsMcp,
  type McpPrincipal,
} from "@/server/mcp/context";

const principal = (userId: string): McpPrincipal => ({
  userId,
  scopes: ["bilan:read"],
  client: { kind: "token", id: `tok_${userId}`, name: `Client ${userId}` },
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("MCP context", () => {
  it("has no principal and no share filter outside an MCP call", () => {
    expect(currentMcpPrincipal()).toBeNull();
    expect(aiShareWhere()).toEqual({});
  });

  it("exposes the principal and narrows shares inside an MCP call", async () => {
    const p = principal("u1");
    const seen = await runAsMcp(p, async () => ({
      principal: currentMcpPrincipal(),
      where: aiShareWhere(),
    }));
    expect(seen.principal).toBe(p);
    expect(seen.where).toEqual({ allowAiAssistants: true });
    expect(currentMcpPrincipal()).toBeNull();
  });

  it("keeps concurrent calls apart across awaits", async () => {
    const run = (userId: string) =>
      runAsMcp(principal(userId), async () => {
        const before = currentMcpPrincipal()?.userId;
        await tick();
        const after = currentMcpPrincipal()?.userId;
        return [before, after];
      });
    const [a, b] = await Promise.all([run("a"), run("b")]);
    expect(a).toEqual(["a", "a"]);
    expect(b).toEqual(["b", "b"]);
  });
});
