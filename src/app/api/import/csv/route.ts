import { getCurrentUser } from "@/server/auth/permissions";
import { createCsvBatch, previewCsvBatch, ImportAccessError } from "@/server/services/imports";
import { decodeCsv } from "@/server/services/imports/csv-parse";

export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export async function POST(req: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  const accountId = String(form.get("accountId") ?? "");
  if (!(file instanceof File) || !accountId) {
    return Response.json({ error: "INVALID" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) return Response.json({ error: "TOO_LARGE" }, { status: 413 });
  const name = file.name.toLowerCase();
  if (!name.endsWith(".csv") && file.type !== "text/csv") {
    return Response.json({ error: "BAD_TYPE" }, { status: 415 });
  }

  const text = decodeCsv(await file.arrayBuffer());
  try {
    const batch = await createCsvBatch(
      { accountId, filename: file.name, text, fileSizeBytes: file.size },
      { id: user.id },
    );
    const preview = await previewCsvBatch(batch.id, user.id);
    return Response.json(preview);
  } catch (e) {
    if (e instanceof ImportAccessError)
      return Response.json({ error: "FORBIDDEN" }, { status: 403 });
    return Response.json({ error: "PARSE_FAILED" }, { status: 422 });
  }
}
