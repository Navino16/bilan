import { z } from "zod";
import { getCurrentUser } from "@/server/auth/permissions";
import { previewPdfBatch } from "@/server/services/imports/pdf-service";
import { importErrorResponse } from "@/server/transport/http/import-errors";

export const runtime = "nodejs";

const bodySchema = z.object({
  pages: z.record(z.string(), z.number().int().min(0)).default({}),
  accounts: z.record(z.string(), z.string()).default({}),
  probableOnly: z.boolean().default(false),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ batchId: string }> },
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { batchId } = await params;
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "INVALID" }, { status: 400 });
  try {
    return Response.json(await previewPdfBatch(batchId, user.id, body.data));
  } catch (e) {
    return importErrorResponse(e, "PARSE_FAILED");
  }
}
