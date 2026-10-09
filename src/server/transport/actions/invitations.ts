"use server";

import { headers } from "next/headers";
import { requireSession } from "@/server/auth/permissions";
import { requestLocale } from "@/server/http/request-locale";
import { invitationAcceptLimiter } from "@/server/auth/rate-limit";
import { GroupAccessError } from "@/server/services/groups";
import { invitationInputSchema } from "@/lib/validation/group";
import { invalidInput, type FormFailure } from "@/lib/validation/field-errors";
import {
  createInvitation,
  revokeInvitation,
  acceptInvitation,
  InvitationError,
} from "@/server/services/groups/invitations";

export type InvitationActionState = { ok: true } | FormFailure | null;
export type AcceptActionState =
  | { ok: true; groupId: string }
  | { ok: false; error: string; hint?: string }
  | null;

function fail(e: unknown): { ok: false; error: string; hint?: string } {
  if (e instanceof InvitationError)
    return { ok: false, error: e.message || "FAILED", hint: e.hint };
  if (e instanceof GroupAccessError) return { ok: false, error: e.message || "FAILED" };
  return { ok: false, error: "FAILED" };
}

export async function createInvitationAction(
  _prev: InvitationActionState,
  formData: FormData,
): Promise<InvitationActionState> {
  const user = await requireSession();
  const groupId = String(formData.get("groupId") ?? "");
  if (!groupId) return { ok: false, error: "INVALID" };
  const parsed = invitationInputSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    role: String(formData.get("role") ?? "MEMBER"),
  });
  if (!parsed.success) return invalidInput(parsed.error);
  try {
    await createInvitation(
      { groupId, ...parsed.data, locale: requestLocale(await headers()) },
      { id: user.id },
    );
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export async function revokeInvitationAction(
  _prev: InvitationActionState,
  formData: FormData,
): Promise<InvitationActionState> {
  const user = await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "INVALID" };
  try {
    await revokeInvitation(id, { id: user.id });
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export async function acceptInvitationAction(
  _prev: AcceptActionState,
  formData: FormData,
): Promise<AcceptActionState> {
  const user = await requireSession();
  const key = String(formData.get("code") || formData.get("token") || "").trim();
  if (!key) return { ok: false, error: "INVALID" };
  if (!invitationAcceptLimiter.consume(user.id).allowed)
    return { ok: false, error: "RATE_LIMITED" };
  try {
    const { groupId } = await acceptInvitation(key, { id: user.id, email: user.email });
    return { ok: true, groupId };
  } catch (e) {
    return fail(e);
  }
}
