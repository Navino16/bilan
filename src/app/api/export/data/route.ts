import { currentStepUpSession } from "@/server/auth/step-up-session";
import { auditOrigin } from "@/server/http/audit-origin";
import { exportOwnData } from "@/server/services/rgpd";
import { toIsoDay } from "@/lib/period";
import { streamOf } from "@/server/http/stream";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(): Promise<Response> {
  const session = await currentStepUpSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers: NO_STORE });

  const res = await exportOwnData(session, await auditOrigin());
  if (!res.ok) {
    return Response.json(
      { error: "REAUTH_REQUIRED", method: res.method },
      { status: 403, headers: NO_STORE },
    );
  }
  return new Response(streamOf(res.json), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="bilan-data-export-${toIsoDay(new Date())}.json"`,
      ...NO_STORE,
    },
  });
}
