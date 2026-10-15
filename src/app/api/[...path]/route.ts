// Unknown API routes answer JSON, not the HTML 404 page (which the API CSP would blank).
function notFound(): Response {
  return Response.json({ error: "NOT_FOUND" }, { status: 404 });
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const HEAD = notFound;
export const OPTIONS = notFound;
