import { getCurrentUser } from "@/server/auth/permissions";
import { ImportAccessError } from "@/server/services/imports";
import { commitPdfBatch } from "@/server/services/imports/pdf-service";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ batchId: string }> },
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { batchId } = await params;
  const body = await req.json().catch(() => null);
  if (!body?.mapping || typeof body.mapping !== "object") {
    return Response.json({ error: "INVALID" }, { status: 400 });
  }
  try {
    const summary = await commitPdfBatch(
      batchId,
      body.mapping as Record<string, string>,
      { id: user.id },
      {
        autoCategorize: body.autoCategorize ?? true,
        overrides: body.overrides ?? {},
        excludedIds: body.excludedIds ?? [],
      },
    );
    return Response.json(summary);
  } catch (e) {
    if (e instanceof ImportAccessError)
      return Response.json({ error: "FORBIDDEN" }, { status: 403 });
    return Response.json({ error: "COMMIT_FAILED" }, { status: 422 });
  }
}
