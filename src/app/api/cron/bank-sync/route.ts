import { env } from "@/env";
import { logEvent } from "@/server/services/audit";
import { sendConsentReminders } from "@/server/services/bank-sync/reminders";
import { syncDueConnections } from "@/server/services/bank-sync/sync";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  if (!env.CRON_SECRET) return new Response(null, { status: 404 });
  if (req.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return new Response(null, { status: 401 });
  }
  const now = new Date();
  const counts = await syncDueConnections(now);
  const { sent } = await sendConsentReminders(now);
  const summary = { ...counts, reminders: sent };
  // An idle run leaves no audit row: the job fires every hour.
  if (counts.due > 0 || sent > 0) {
    await logEvent({ userId: null, action: "bank_sync.cron", metadata: summary });
  }
  return Response.json(summary);
}
