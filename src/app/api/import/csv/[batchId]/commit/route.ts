import { getCurrentUser } from "@/server/auth/permissions";
import { commitCsvBatch, ImportAccessError } from "@/server/services/imports";

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
    const summary = await commitCsvBatch(
      batchId,
      body.mapping,
      { id: user.id },
      {
        autoCategorize: body.autoCategorize ?? true,
        overrides: body.overrides ?? {},
        excludedIds: body.excludedIds ?? [],
      },
    );
    return Response.json(summary);
  } catch (e) {
    if (e instanceof ImportAccessError) {
      return e.message === "NOT_COMMITTABLE"
        ? Response.json({ error: "NOT_COMMITTABLE" }, { status: 409 })
        : Response.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    return Response.json({ error: "COMMIT_FAILED" }, { status: 422 });
  }
}
