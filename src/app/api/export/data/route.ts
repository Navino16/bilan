import { getCurrentUser } from "@/server/auth/permissions";
import { exportUserData } from "@/server/services/rgpd";
import { toIsoDay } from "@/lib/period";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const data = await exportUserData(user.id);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="bilan-data-export-${toIsoDay(new Date())}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
