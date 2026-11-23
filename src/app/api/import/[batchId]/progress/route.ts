import { getCurrentUser } from "@/server/auth/permissions";
import { getCommitProgress } from "@/server/services/imports";
import { importErrorResponse } from "@/server/transport/http/import-errors";

export const runtime = "nodejs";

// Polled by the wizard while a commit runs.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ batchId: string }> },
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { batchId } = await params;
  try {
    return Response.json(await getCommitProgress(batchId, user.id));
  } catch (e) {
    return importErrorResponse(e, "FAILED");
  }
}
