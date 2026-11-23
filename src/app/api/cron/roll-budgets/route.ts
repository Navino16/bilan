import { env } from "@/env";
import { rollRecurringBudgets } from "@/server/services/budgets";

export const runtime = "nodejs";

// Rolls every ended recurring budget that has no next-period instance yet. The
// deferred Phase-7 automation; idempotent (a series with a later period isn't rolled).
export async function POST(req: Request): Promise<Response> {
  if (!env.CRON_SECRET) return new Response(null, { status: 404 });
  if (req.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return new Response(null, { status: 401 });
  }
  return Response.json(await rollRecurringBudgets(new Date()));
}
