import { handleMcpRequest } from "@/server/mcp/http";

export const runtime = "nodejs";

// Next hands route handlers the request behind a Proxy that the SDK's transport can't read
// (same rebuild as the /api/auth route).
async function handle(req: Request): Promise<Response> {
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return handleMcpRequest(
    new Request(req.url, {
      method: req.method,
      headers: req.headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
    }),
  );
}

export { handle as GET, handle as POST, handle as DELETE };
