import { env } from "@/env";
import { logEvent } from "@/server/services/audit";
import { purgeStaleImports } from "@/server/services/imports/revert";

export const runtime = "nodejs";

const STALE_MS = 24 * 3600 * 1000;

// Token-guarded like purge-audit: unset CRON_SECRET → 404, wrong token → 401.
export async function POST(req: Request): Promise<Response> {
  if (!env.CRON_SECRET) return new Response(null, { status: 404 });
  if (req.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return new Response(null, { status: 401 });
  }
  const count = await purgeStaleImports(new Date(Date.now() - STALE_MS));
  await logEvent({ userId: null, action: "import.purged", metadata: { count } });
  return Response.json({ purged: count });
}
