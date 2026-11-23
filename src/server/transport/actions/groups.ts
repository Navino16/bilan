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
import { groupInputSchema } from "@/lib/schemas/group";
import { invalidInput, type FormFailure } from "@/lib/validation/field-errors";

export type GroupActionState = { ok: true } | FormFailure | null;

function groupInput(formData: FormData) {
  return groupInputSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
  });
}

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
  const parsed = groupInput(formData);
  if (!parsed.success) return invalidInput(parsed.error);
  try {
    await createGroup(parsed.data, user.id);
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
  const parsed = groupInput(formData);
  if (!parsed.success) return invalidInput(parsed.error);
  try {
    await updateGroup(id, parsed.data, { id: user.id });
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
