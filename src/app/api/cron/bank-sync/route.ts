import { env } from "@/env";
import { logEvent } from "@/server/services/audit";
import { syncDueConnections } from "@/server/services/bank-sync/sync";

export const runtime = "nodejs";

// Hourly; each connection is synced once its interval has elapsed (design §Sync engine).
export async function POST(req: Request): Promise<Response> {
  if (!env.CRON_SECRET) return new Response(null, { status: 404 });
  if (req.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return new Response(null, { status: 401 });
  }
  const counts = await syncDueConnections(new Date());
  // An idle run leaves no audit row: the job fires every hour.
  if (counts.due > 0) await logEvent({ userId: null, action: "bank_sync.cron", metadata: counts });
  return Response.json(counts);
}
