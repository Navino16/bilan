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

// Spread into every AccountShare lookup: inside an MCP call only the shares whose owner
// allowed AI assistants count (design §4).
export function aiShareWhere(): { allowAiAssistants: true } | Record<string, never> {
  return currentMcpPrincipal() ? { allowAiAssistants: true } : {};
}
