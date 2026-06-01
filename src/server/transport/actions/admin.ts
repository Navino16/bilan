"use server";

import { getCurrentUser, hasPermission } from "@/server/auth/permissions";
import { adminCreateUser, adminCreateUserSchema } from "@/server/services/users/create";
import { createSignupToken, revokeSignupToken } from "@/server/services/signup-tokens";
import { logEvent } from "@/server/services/audit";

export type AdminActionState = { ok: true } | { ok: false; error: string } | null;

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

  const parsed = adminCreateUserSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "INVALID" };

  try {
    await adminCreateUser(parsed.data, { id: actor.id });
    return { ok: true };
  } catch {
    return { ok: false, error: "FAILED" };
  }
}

export async function createSignupTokenAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const actor = await requirePerm("admin.signup_tokens.manage");
  if (!actor) return { ok: false, error: "UNAUTHORIZED" };

  const description = String(formData.get("description") ?? "").trim() || undefined;
  const maxUsesRaw = String(formData.get("maxUses") ?? "").trim();
  const maxUses = maxUsesRaw ? Number(maxUsesRaw) : null;
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) {
    return { ok: false, error: "INVALID" };
  }

  const { id } = await createSignupToken({ description, maxUses, createdById: actor.id });
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

  await revokeSignupToken(id);
  await logEvent({
    userId: actor.id,
    action: "signup_token.revoked",
    entity: "AdminSignupToken",
    entityId: id,
  });
  return { ok: true };
}
