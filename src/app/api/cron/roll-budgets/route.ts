import { env } from "@/env";
import { listRollableTemplates, rollRecurringSystem } from "@/server/services/budgets";

export const runtime = "nodejs";

// Rolls every ended recurring budget that has no next-period instance yet. The
// deferred Phase-7 automation; idempotent (each roll re-checks for existence).
export async function POST(req: Request): Promise<Response> {
  if (!env.CRON_SECRET) return new Response(null, { status: 404 });
  if (req.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return new Response(null, { status: 401 });
  }
  const templates = await listRollableTemplates(new Date());
  let created = 0;
  for (const tmpl of templates) {
    const r = await rollRecurringSystem(tmpl.id);
    if (r.created) created += 1;
  }
  return Response.json({ checked: templates.length, rolled: created });
}
