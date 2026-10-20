import { getCurrentUser } from "@/server/auth/permissions";
import { RuleAccessError } from "@/server/services/categorization";
import { exportRules } from "@/server/services/categorization/rules-export";
import { toIsoDay } from "@/lib/period";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const groupId = new URL(req.url).searchParams.get("groupId") || null;
  let file;
  try {
    file = await exportRules({ groupId }, user);
  } catch (e) {
    if (e instanceof RuleAccessError) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
    throw e;
  }
  return new Response(JSON.stringify(file, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="bilan-rules-${toIsoDay(new Date())}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
