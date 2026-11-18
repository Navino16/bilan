export const MCP_TOKEN_PREFIX = "bilan_pat_";
export const MCP_TOKEN_NAME_MAX = 80;
export const MCP_TOKEN_SCOPES = ["read", "write"] as const;
export const MCP_TOKEN_EXPIRY_CHOICES = ["never", "30", "90", "365"] as const;

export type McpTokenScope = (typeof MCP_TOKEN_SCOPES)[number];
export type McpTokenExpiry = (typeof MCP_TOKEN_EXPIRY_CHOICES)[number];

export function mcpTokenExpiry(choice: McpTokenExpiry, now: Date): Date | null {
  return choice === "never" ? null : new Date(now.getTime() + Number(choice) * 86_400_000);
}
