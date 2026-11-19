import { AsyncLocalStorage } from "node:async_hooks";

export type McpScope = "bilan:read" | "bilan:write";

export type McpPrincipal = {
  userId: string;
  scopes: McpScope[];
  client: { kind: "token" | "oauth"; id: string; name: string };
};

const storage = new AsyncLocalStorage<McpPrincipal>();

export function runAsMcp<T>(principal: McpPrincipal, fn: () => Promise<T>): Promise<T> {
  return storage.run(principal, fn);
}

export function currentMcpPrincipal(): McpPrincipal | null {
  return storage.getStore() ?? null;
}

// Spread into the share lookups that decide account visibility and access (budget scopes use
// householdShareWhere): in an MCP call only shares allowing AI assistants count (spec §5.18).
export function aiShareWhere(): { allowAiAssistants: true } | Record<string, never> {
  return currentMcpPrincipal() ? { allowAiAssistants: true } : {};
}
