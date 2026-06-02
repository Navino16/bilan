"use server";

import { requireSession } from "@/server/auth/permissions";
import { GroupAccessError } from "@/server/services/groups";
import { GROUP_ROLES, type GroupRole } from "@/lib/validation/group";
import {
  createInvitation,
  revokeInvitation,
  acceptInvitation,
  InvitationError,
} from "@/server/services/groups/invitations";

export type InvitationActionState = { ok: true } | { ok: false; error: string } | null;
export type AcceptActionState = { ok: true; groupId: string } | { ok: false; error: string } | null;

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof InvitationError || e instanceof GroupAccessError) {
    return { ok: false, error: e.message || "FAILED" };
  }
  return { ok: false, error: "FAILED" };
}

export async function createInvitationAction(
  _prev: InvitationActionState,
  formData: FormData,
): Promise<InvitationActionState> {
  const user = await requireSession();
  const groupId = String(formData.get("groupId") ?? "");
  const email = String(formData.get("email") ?? "");
  const role = String(formData.get("role") ?? "MEMBER") as GroupRole;
  if (!groupId || !email || !GROUP_ROLES.includes(role)) return { ok: false, error: "INVALID" };
  try {
    await createInvitation({ groupId, email, role }, { id: user.id });
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
  try {
    const { groupId } = await acceptInvitation(key, { id: user.id, email: user.email });
    return { ok: true, groupId };
  } catch (e) {
    return fail(e);
  }
}
