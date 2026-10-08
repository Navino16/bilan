import { getAuth } from "@/server/auth";
import { withClientIp } from "@/server/http/client-ip";

// Next hands route handlers the request behind a Proxy, which `new Request(req)` rejects
// (undici reads its private fields), so the copy is rebuilt from its properties.
async function handle(req: Request): Promise<Response> {
  const auth = await getAuth();
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return auth.handler(
    new Request(req.url, {
      method: req.method,
      headers: withClientIp(req.headers),
      body: hasBody ? await req.arrayBuffer() : undefined,
    }),
  );
}

export { handle as GET, handle as POST };
