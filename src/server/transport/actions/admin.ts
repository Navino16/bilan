"use server";

import { getCurrentUser, hasPermission } from "@/server/auth/permissions";
import {
  adminCreateUser,
  adminCreateUserSchema,
  UserExistsError,
} from "@/server/services/users/create";
import { RoleChangeError, setUserRole } from "@/server/services/users/roles";
import { isInstanceRole } from "@/lib/instance-roles";
import {
  createSignupToken,
  deleteSignupToken,
  revokeSignupToken,
} from "@/server/services/signup-tokens";
import { createSignupTokenSchema, signupTokenExpiry } from "@/lib/validation/signup-token";
import { logEvent } from "@/server/services/audit";
import { failureOnField, invalidInput, type FormFailure } from "@/lib/validation/field-errors";
import {
  adminDeleteUser,
  setUserDisabled,
  UserAdminError,
  userDeletionImpact,
  type UserDeletionImpact,
} from "@/server/services/users/lifecycle";

export type AdminActionState = { ok: true } | FormFailure | null;
export type UserLifecycleState = { ok: true } | { ok: false; error: string } | null;

async function requirePerm(key: string): Promise<{ id: string } | null> {
  const user = await getCurrentUser();
  if (!user || !(await hasPermission(user.id, key))) return null;
  return user;
}

export async function adminCreateUserAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const actor = await requirePerm("admin.users.create");
  if (!actor) return { ok: false, error: "UNAUTHORIZED" };

  const input = Object.fromEntries(formData);
  const parsed = adminCreateUserSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error, input);

  try {
    await adminCreateUser(parsed.data, { id: actor.id });
    return { ok: true };
  } catch (e) {
    if (e instanceof UserExistsError)
      return failureOnField({ ok: false, error: "USER_EXISTS" }, { USER_EXISTS: "email" });
    return { ok: false, error: "FAILED" };
  }
}

export async function setUserRoleAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const actor = await requirePerm("admin.users.update");
  if (!actor) return { ok: false, error: "UNAUTHORIZED" };

  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!userId || !isInstanceRole(role)) return { ok: false, error: "INVALID" };

  try {
    await setUserRole({ id: actor.id }, userId, role);
    return { ok: true };
  } catch (e) {
    if (e instanceof RoleChangeError) return { ok: false, error: e.message };
    return { ok: false, error: "FAILED" };
  }
}

export async function createSignupTokenAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const actor = await requirePerm("admin.signup_tokens.manage");
  if (!actor) return { ok: false, error: "UNAUTHORIZED" };

  const parsed = createSignupTokenSchema.safeParse({
    description: String(formData.get("description") ?? ""),
    maxUses: String(formData.get("maxUses") ?? ""),
    expiresInDays: String(formData.get("expiresInDays") ?? ""),
  });
  if (!parsed.success) return invalidInput(parsed.error);
  const { description, maxUses, expiresInDays } = parsed.data;

  let id: string;
  try {
    ({ id } = await createSignupToken({
      description,
      maxUses,
      expiresAt: signupTokenExpiry(expiresInDays, new Date()),
      createdById: actor.id,
    }));
  } catch {
    return { ok: false, error: "FAILED" };
  }
  await logEvent({
    userId: actor.id,
    action: "signup_token.created",
    entity: "AdminSignupToken",
    entityId: id,
  });
  return { ok: true };
}

export async function revokeSignupTokenAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const actor = await requirePerm("admin.signup_tokens.manage");
  if (!actor) return { ok: false, error: "UNAUTHORIZED" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, error: "INVALID" };

  if (!(await revokeSignupToken(id))) return { ok: true };
  await logEvent({
    userId: actor.id,
    action: "signup_token.revoked",
    entity: "AdminSignupToken",
    entityId: id,
  });
  return { ok: true };
}

export async function deleteSignupTokenAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const actor = await requirePerm("admin.signup_tokens.manage");
  if (!actor) return { ok: false, error: "UNAUTHORIZED" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, error: "INVALID" };

  if (!(await deleteSignupToken(id))) return { ok: false, error: "STILL_ACTIVE" };
  await logEvent({
    userId: actor.id,
    action: "signup_token.deleted",
    entity: "AdminSignupToken",
    entityId: id,
  });
  return { ok: true };
}

export async function setUserDisabledAction(
  _prev: UserLifecycleState,
  formData: FormData,
): Promise<UserLifecycleState> {
  const actor = await requirePerm("admin.users.disable");
  if (!actor) return { ok: false, error: "UNAUTHORIZED" };

  const userId = String(formData.get("userId") ?? "");
  const disabled = String(formData.get("disabled") ?? "");
  if (!userId || !["true", "false"].includes(disabled)) return { ok: false, error: "INVALID" };

  try {
    await setUserDisabled({ id: actor.id }, userId, disabled === "true");
    return { ok: true };
  } catch (e) {
    if (e instanceof UserAdminError) return { ok: false, error: e.code };
    return { ok: false, error: "FAILED" };
  }
}

export async function adminDeleteUserAction(
  _prev: UserLifecycleState,
  formData: FormData,
): Promise<UserLifecycleState> {
  const actor = await requirePerm("admin.users.delete");
  if (!actor) return { ok: false, error: "UNAUTHORIZED" };

  const userId = String(formData.get("userId") ?? "");
  const confirmEmail = String(formData.get("confirmEmail") ?? "");
  if (!userId) return { ok: false, error: "INVALID" };

  try {
    await adminDeleteUser({ id: actor.id }, userId, confirmEmail);
    return { ok: true };
  } catch (e) {
    if (e instanceof UserAdminError) return { ok: false, error: e.code };
    return { ok: false, error: "FAILED" };
  }
}

export async function getUserDeletionImpactAction(
  userId: string,
): Promise<{ ok: true; impact: UserDeletionImpact } | { ok: false; error: string }> {
  const actor = await requirePerm("admin.users.delete");
  if (!actor) return { ok: false, error: "UNAUTHORIZED" };
  const impact = await userDeletionImpact(userId);
  return impact ? { ok: true, impact } : { ok: false, error: "NOT_FOUND" };
}
