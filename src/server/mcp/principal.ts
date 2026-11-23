import type { McpPrincipal } from "./context";
import { OAUTH_ACCESS_TOKEN_PREFIX } from "./oauth-config";
import { principalFromOAuthToken } from "./oauth-principal";
import { MCP_TOKEN_PREFIX, principalFromToken } from "./tokens";

export async function resolveMcpPrincipal(
  token: string,
): Promise<McpPrincipal | "insufficient_scope" | null> {
  if (token.startsWith(MCP_TOKEN_PREFIX)) return principalFromToken(token);
  if (token.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)) return principalFromOAuthToken(token);
  return null;
}
