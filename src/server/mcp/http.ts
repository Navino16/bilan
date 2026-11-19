import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { mcpCallLimiter } from "@/server/auth/rate-limit";
import { mcpChallenge } from "./discovery";
import { buildMcpServer } from "./server";
import { isMcpInstanceEnabled } from "./switches";
import { principalFromToken } from "./tokens";

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function bearerToken(req: Request): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  return match?.[1] ?? null;
}

// Next hands route handlers the request behind a Proxy the transport can't read, so it is
// rebuilt; the body is only buffered once the caller is authenticated.
async function rebuilt(req: Request): Promise<Request> {
  return new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body: await req.arrayBuffer(),
  });
}

// Stateless Streamable HTTP (spec §5.18): a fresh transport and server per request.
export async function handleMcpRequest(req: Request): Promise<Response> {
  try {
    if (!(await isMcpInstanceEnabled())) return json({ error: "NOT_FOUND" }, 404);
    if (req.method !== "POST") {
      return json({ error: "METHOD_NOT_ALLOWED" }, 405, { Allow: "POST" });
    }

    const token = bearerToken(req);
    const principal = token ? await principalFromToken(token) : null;
    if (!principal) {
      return json({ error: "UNAUTHORIZED" }, 401, {
        "WWW-Authenticate": mcpChallenge(token ? "invalid_token" : undefined),
      });
    }

    const outcome = mcpCallLimiter.consume(`${principal.client.kind}:${principal.client.id}`);
    if (!outcome.allowed) {
      return json({ error: "RATE_LIMITED" }, 429, { "Retry-After": String(outcome.retryAfterSec) });
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await buildMcpServer(principal).connect(transport);
    const res = await transport.handleRequest(await rebuilt(req));
    const out = new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: new Headers(res.headers),
    });
    out.headers.set("Cache-Control", "no-store");
    return out;
  } catch (e) {
    console.error("[bilan] MCP request failed", e);
    return json({ error: "INTERNAL" }, 500);
  }
}
