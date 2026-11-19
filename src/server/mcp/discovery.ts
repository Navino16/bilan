import { env } from "@/env";
import { MCP_OAUTH_SCOPES, mcpResourceUrl, oauthApi, oauthIssuer } from "./oauth-config";
import { isMcpInstanceEnabled } from "./switches";

const appUrl = env.APP_URL.replace(/\/$/, "");

export function protectedResourceMetadataUrl(): string {
  return `${appUrl}/.well-known/oauth-protected-resource/api/mcp`;
}

export function protectedResourceMetadata(appName: string) {
  return {
    resource: mcpResourceUrl(),
    authorization_servers: [oauthIssuer()],
    scopes_supported: [...MCP_OAUTH_SCOPES],
    bearer_methods_supported: ["header"] as ["header"],
    resource_name: appName,
  };
}

// Endpoints answering 404 over HTTP (spec §5.18) must not be advertised.
const UNREACHABLE_KEYS = ["userinfo_endpoint", "end_session_endpoint", "jwks_uri"];

export async function authorizationServerMetadata(): Promise<Record<string, unknown>> {
  const config = await (await oauthApi()).getOAuthServerConfig();
  return Object.fromEntries(
    Object.entries(config).filter(
      ([key]) => !key.startsWith("introspection_endpoint") && !UNREACHABLE_KEYS.includes(key),
    ),
  );
}

export function mcpChallenge(error?: "invalid_token" | "insufficient_scope"): string {
  const base = `Bearer realm="bilan", resource_metadata="${protectedResourceMetadataUrl()}"`;
  if (error === "insufficient_scope")
    return `${base}, error="insufficient_scope", scope="bilan:read"`;
  const challenge = `${base}, scope="${MCP_OAUTH_SCOPES.join(" ")}"`;
  return error ? `${challenge}, error="invalid_token"` : challenge;
}

const PUBLIC_HEADERS = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };

export type DiscoveryParams = { params: Promise<{ path?: string[] }> };

// Serves a document at the root and at its RFC 8414/9728 path-inserted suffix only.
export async function serveDiscovery(
  { params }: DiscoveryParams,
  suffix: string,
  build: () => unknown | Promise<unknown>,
): Promise<Response> {
  try {
    const path = `/${((await params).path ?? []).join("/")}`.replace(/^\/$/, "");
    if (!(await isMcpInstanceEnabled()) || (path !== "" && path !== suffix)) {
      return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: PUBLIC_HEADERS });
    }
    return Response.json(await build(), { headers: PUBLIC_HEADERS });
  } catch (e) {
    console.error("[bilan] OAuth discovery failed", e);
    return Response.json({ error: "INTERNAL" }, { status: 500, headers: PUBLIC_HEADERS });
  }
}
