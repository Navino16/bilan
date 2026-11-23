import { getCurrentUser } from "@/server/auth/permissions";
import { commitOfxBatch } from "@/server/services/imports/ofx-service";
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
  if (!body?.mapping || typeof body.mapping !== "object") {
    return Response.json({ error: "INVALID" }, { status: 400 });
  }
  const includedProbableIds: unknown = body.includedProbableIds ?? [];
  if (
    !Array.isArray(includedProbableIds) ||
    includedProbableIds.some((i) => typeof i !== "string")
  ) {
    return Response.json({ error: "INVALID" }, { status: 400 });
  }
  const adjustBalance: unknown = body.adjustBalance ?? [];
  if (!Array.isArray(adjustBalance) || adjustBalance.some((i) => typeof i !== "string")) {
    return Response.json({ error: "INVALID" }, { status: 400 });
  }
  try {
    const summary = await commitOfxBatch(
      batchId,
      body.mapping as Record<string, string>,
      { id: user.id },
      {
        autoCategorize: body.autoCategorize ?? true,
        overrides: body.overrides ?? {},
        excludedIds: body.excludedIds ?? [],
        includedProbableIds,
        adjustBalance,
      },
    );
    return Response.json(summary);
  } catch (e) {
    return importErrorResponse(e, "COMMIT_FAILED");
  }
}
