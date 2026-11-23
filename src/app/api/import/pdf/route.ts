import { getCurrentUser } from "@/server/auth/permissions";
import { createPdfBatch, previewPdfBatch } from "@/server/services/imports/pdf-service";
import { ImportAccessError } from "@/server/services/imports/errors";
import { importErrorResponse } from "@/server/transport/http/import-errors";
import { PDF_MAX_BYTES } from "@/lib/validation/import";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  const accountId = String(form.get("accountId") ?? "");
  if (!(file instanceof File) || !accountId)
    return Response.json({ error: "INVALID" }, { status: 400 });
  if (file.size > PDF_MAX_BYTES) return Response.json({ error: "TOO_LARGE" }, { status: 413 });
  const name = file.name.toLowerCase();
  if (!name.endsWith(".pdf") && file.type !== "application/pdf") {
    return Response.json({ error: "BAD_TYPE" }, { status: 415 });
  }
  if (file.size === 0) return Response.json({ error: "EMPTY" }, { status: 422 });

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    const batch = await createPdfBatch({ accountId, filename: file.name, buffer }, { id: user.id });
    const preview = await previewPdfBatch(batch.id, user.id);
    return Response.json(preview);
  } catch (e) {
    if (e instanceof ImportAccessError) return importErrorResponse(e, "PARSE_FAILED");
    console.error("[import/pdf] parse failed:", e);
    return Response.json({ error: "PARSE_FAILED" }, { status: 422 });
  }
}
