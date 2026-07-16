"use server";

import { requireSession } from "@/server/auth/permissions";
import { createLink, deleteLink, ignoreSuggestion, LinkAccessError } from "@/server/services/links";

export type LinkActionState = { ok: true; id?: string } | { ok: false; error: string } | null;

function mapError(e: unknown): string {
  return e instanceof LinkAccessError ? e.message || "FORBIDDEN" : "FAILED";
}

export async function createLinkAction(
  _prev: LinkActionState,
  formData: FormData,
): Promise<LinkActionState> {
  const user = await requireSession();
  const ids = String(formData.get("transactionIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length < 2) return { ok: false, error: "TOO_FEW" };
  try {
    const { id } = await createLink({ transactionIds: ids, userId: user.id });
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
}

export async function deleteLinkAction(
  _prev: LinkActionState,
  formData: FormData,
): Promise<LinkActionState> {
  const user = await requireSession();
  const id = String(formData.get("linkId") ?? "");
  if (!id) return { ok: false, error: "INVALID" };
  try {
    await deleteLink(id, user.id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
}

export async function ignoreSuggestionAction(
  _prev: LinkActionState,
  formData: FormData,
): Promise<LinkActionState> {
  const user = await requireSession();
  const pairKey = String(formData.get("pairKey") ?? "");
  if (!pairKey.includes("|")) return { ok: false, error: "INVALID" };
  try {
    await ignoreSuggestion(user.id, pairKey);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
}
