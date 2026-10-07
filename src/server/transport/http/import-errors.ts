import { ImportAccessError } from "@/server/services/imports/errors";

const STATUS: Record<string, number> = {
  INVALID_MAPPING: 400,
  NOT_COMMITTABLE: 409,
  NOTHING_TO_IMPORT: 409,
  ACCOUNT_ARCHIVED: 409,
  EMPTY: 422,
};

// Maps an import service error to its JSON response. Access errors (including a
// missing batch) all read FORBIDDEN, so batch ids can't be probed.
export function importErrorResponse(e: unknown, fallback: string): Response {
  if (e instanceof ImportAccessError) {
    const status = STATUS[e.message];
    return status
      ? Response.json({ error: e.message }, { status })
      : Response.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  console.error(`[import] ${fallback}:`, e);
  return Response.json({ error: fallback }, { status: 422 });
}
