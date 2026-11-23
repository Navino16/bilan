import { getCurrentUser } from "@/server/auth/permissions";
import { PREVIEW_FILTERS } from "@/lib/validation/import";
import { previewCsvBatch } from "@/server/services/imports";
import { importErrorResponse } from "@/server/transport/http/import-errors";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ batchId: string }> },
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { batchId } = await params;
  const body = await req.json().catch(() => null);
  if (!body?.mapping) return Response.json({ error: "INVALID" }, { status: 400 });
  try {
    return Response.json(
      await previewCsvBatch(batchId, user.id, body.mapping, Number(body.page) || 0, {
        filter: PREVIEW_FILTERS.find((f) => f === body.filter) ?? "all",
      }),
    );
  } catch (e) {
    return importErrorResponse(e, "PARSE_FAILED");
  }
}
