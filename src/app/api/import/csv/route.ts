import { getCurrentUser } from "@/server/auth/permissions";
import { createCsvBatch, previewCsvBatch } from "@/server/services/imports";
import { decodeCsv, hasDataRows, looksBinary } from "@/server/services/imports/csv-parse";
import { importErrorResponse } from "@/server/transport/http/import-errors";
import { CSV_MAX_BYTES } from "@/lib/validation/import";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  const accountId = String(form.get("accountId") ?? "");
  if (!(file instanceof File) || !accountId) {
    return Response.json({ error: "INVALID" }, { status: 400 });
  }
  if (file.size > CSV_MAX_BYTES) return Response.json({ error: "TOO_LARGE" }, { status: 413 });
  const name = file.name.toLowerCase();
  if (!name.endsWith(".csv") && file.type !== "text/csv") {
    return Response.json({ error: "BAD_TYPE" }, { status: 415 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (looksBinary(bytes)) return Response.json({ error: "NOT_TEXT" }, { status: 415 });
  const text = decodeCsv(bytes);
  if (!hasDataRows(text)) return Response.json({ error: "EMPTY" }, { status: 422 });
  try {
    const batch = await createCsvBatch(
      { accountId, filename: file.name, text, fileSizeBytes: file.size },
      { id: user.id },
    );
    return Response.json(await previewCsvBatch(batch.id, user.id));
  } catch (e) {
    return importErrorResponse(e, "PARSE_FAILED");
  }
}
