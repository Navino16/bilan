import { env } from "@/env";
import { purgeAuditOlderThan, logEvent } from "@/server/services/audit";

export const runtime = "nodejs";

const RETENTION_MS = 365 * 24 * 3600 * 1000; // 12 months

// Token-guarded: unset CRON_SECRET → 404 (inert by default); wrong token → 401.
export async function POST(req: Request): Promise<Response> {
  if (!env.CRON_SECRET) return new Response(null, { status: 404 });
  if (req.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return new Response(null, { status: 401 });
  }
  const cutoff = new Date(Date.now() - RETENTION_MS);
  const count = await purgeAuditOlderThan(cutoff);
  await logEvent({ userId: null, action: "audit.purged", metadata: { count } });
  return Response.json({ purged: count });
}
