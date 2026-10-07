import { getCurrentUser } from "@/server/auth/permissions";
import { previewCsvBatch, ImportAccessError } from "@/server/services/imports";

export const runtime = "nodejs";

// Re-previews a CSV batch with the column mapping edited in the wizard.
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
    return Response.json(await previewCsvBatch(batchId, user.id, body.mapping));
  } catch (e) {
    if (e instanceof ImportAccessError) {
      if (e.message === "INVALID_MAPPING") {
        return Response.json({ error: "INVALID_MAPPING" }, { status: 400 });
      }
      if (e.message === "NOT_COMMITTABLE") {
        return Response.json({ error: "NOT_COMMITTABLE" }, { status: 409 });
      }
      return Response.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    return Response.json({ error: "PARSE_FAILED" }, { status: 422 });
  }
}
