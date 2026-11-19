import { APIError, createAuthMiddleware } from "better-auth/api";
import type { BetterAuthPlugin } from "better-auth";
import { CLIENT_IP_HEADER } from "@/server/http/client-ip";
import { isMcpInstanceEnabled } from "@/server/mcp/switches";
import { purgeStaleOAuthClients } from "@/server/mcp/oauth-grants";
import { oauthRegisterLimiter } from "./rate-limit";

type GuardContext = { path: string; headers?: Headers };

async function guard(ctx: GuardContext): Promise<void> {
  if (!(await isMcpInstanceEnabled())) throw new APIError("NOT_FOUND");
  if (ctx.path !== "/oauth2/register") return;

  const outcome = oauthRegisterLimiter.consume(ctx.headers?.get(CLIENT_IP_HEADER) || "unknown");
  if (!outcome.allowed) {
    throw new APIError(
      "TOO_MANY_REQUESTS",
      { code: "RATE_LIMITED", retryAfter: outcome.retryAfterSec },
      { "Retry-After": String(outcome.retryAfterSec) },
    );
  }
  await purgeStaleOAuthClients().catch((e) =>
    console.error("[bilan] stale OAuth client purge failed", e),
  );
}

// Keeps the OAuth provider dark while the MCP instance switch is off (spec §5.18).
export const mcpOAuthGuardPlugin = {
  id: "bilan-mcp-oauth-guard",
  hooks: {
    before: [
      {
        matcher: (ctx) => ctx.path?.startsWith("/oauth2/") ?? false,
        handler: createAuthMiddleware(async (ctx) => guard(ctx)),
      },
    ],
  },
} satisfies BetterAuthPlugin;
