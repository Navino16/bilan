import { env } from "@/env";
import { logEvent } from "@/server/services/audit";
import { purgeExpiredAuthRequests } from "@/server/services/bank-sync/connect";
import { purgeStaleImports } from "@/server/services/imports/revert";

export const runtime = "nodejs";

const STALE_MS = 24 * 3600 * 1000;

export async function POST(req: Request): Promise<Response> {
  if (!env.CRON_SECRET) return new Response(null, { status: 404 });
  if (req.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return new Response(null, { status: 401 });
  }
  const now = new Date();
  const count = await purgeStaleImports(new Date(now.getTime() - STALE_MS));
  const authRequests = await purgeExpiredAuthRequests(now);
  await logEvent({ userId: null, action: "import.purged", metadata: { count, authRequests } });
  return Response.json({ purged: count, authRequests });
}
