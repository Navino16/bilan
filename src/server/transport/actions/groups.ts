"use server";

import { requireSession } from "@/server/auth/permissions";
import {
  createGroup,
  updateGroup,
  deleteGroup,
  changeMemberRole,
  removeMember,
  leaveGroup,
  GroupAccessError,
} from "@/server/services/groups";
import { GROUP_ROLES, type GroupRole } from "@/server/services/groups/roles";

export type GroupActionState = { ok: true } | { ok: false; error: string } | null;

// Maps any thrown GroupAccessError (FORBIDDEN/INVALID/LAST_OWNER/NOT_MEMBER) to a
// single user-facing error code; anything else becomes FAILED.
function fail(e: unknown): GroupActionState {
  return { ok: false, error: e instanceof GroupAccessError ? e.message || "FAILED" : "FAILED" };
}

export async function createGroupAction(
  _prev: GroupActionState,
  formData: FormData,
): Promise<GroupActionState> {
  const user = await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "");
  if (!name) return { ok: false, error: "INVALID" };
  try {
    await createGroup({ name, description }, user.id);
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export async function updateGroupAction(
  _prev: GroupActionState,
  formData: FormData,
): Promise<GroupActionState> {
  const user = await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "INVALID" };
  try {
    await updateGroup(
      id,
      {
        name: String(formData.get("name") ?? ""),
        description: String(formData.get("description") ?? ""),
      },
      { id: user.id },
    );
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export async function deleteGroupAction(
  _prev: GroupActionState,
  formData: FormData,
): Promise<GroupActionState> {
  const user = await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "INVALID" };
  try {
    await deleteGroup(id, { id: user.id });
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export async function changeMemberRoleAction(
  _prev: GroupActionState,
  formData: FormData,
): Promise<GroupActionState> {
  const user = await requireSession();
  const id = String(formData.get("id") ?? "");
  const targetUserId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "") as GroupRole;
  if (!id || !targetUserId || !GROUP_ROLES.includes(role)) return { ok: false, error: "INVALID" };
  try {
    await changeMemberRole(id, targetUserId, role, { id: user.id });
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export async function removeMemberAction(
  _prev: GroupActionState,
  formData: FormData,
): Promise<GroupActionState> {
  const user = await requireSession();
  const id = String(formData.get("id") ?? "");
  const targetUserId = String(formData.get("userId") ?? "");
  if (!id || !targetUserId) return { ok: false, error: "INVALID" };
  try {
    await removeMember(id, targetUserId, { id: user.id });
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export async function leaveGroupAction(
  _prev: GroupActionState,
  formData: FormData,
): Promise<GroupActionState> {
  const user = await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "INVALID" };
  try {
    await leaveGroup(id, user.id);
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}
