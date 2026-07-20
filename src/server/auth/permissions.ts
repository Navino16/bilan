import type { PrismaClient } from "@prisma/client";
import { headers as nextHeaders } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { appSettings } from "@/server/services/settings/app-settings";

export function buildPermissionsChecker(database: PrismaClient) {
  return async function hasPermission(userId: string, permissionKey: string): Promise<boolean> {
    const user = await database.user.findUnique({
      where: { id: userId },
      include: {
        roles: {
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        },
      },
    });
    if (!user) return false;
    return user.roles.some((ur) =>
      ur.role.permissions.some((rp) => rp.permission.key === permissionKey),
    );
  };
}

export const hasPermission = buildPermissionsChecker(db);

export async function getCurrentUser() {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await nextHeaders() });
  return session?.user ?? null;
}

export async function requireSession() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requirePermission(permissionKey: string) {
  const user = await requireSession();
  const ok = await hasPermission(user.id, permissionKey);
  if (!ok) redirect("/403");
  return user;
}

// Pure gate predicate (spec §6.11): an admin must set up 2FA before using the
// admin area once the instance requires it. True only when all three hold.
export function requiresTwoFactorSetup(input: {
  isAdmin: boolean;
  twoFactorEnabled: boolean;
  settingOn: boolean;
}): boolean {
  return input.isAdmin && input.settingOn && !input.twoFactorEnabled;
}

// Server gate: if admin-mandatory 2FA is on and this admin hasn't enrolled,
// redirect them to the security settings to set it up. Called after
// requirePermission in the admin layout. `admin.settings.write` proxies "is admin".
export async function requireAdmin2fa(locale: string): Promise<void> {
  const user = await requireSession();
  const [isAdmin, settingOn, row] = await Promise.all([
    hasPermission(user.id, "admin.settings.write"),
    appSettings.get<boolean>("security.admin_2fa_required").then((v) => v ?? false),
    db.user.findUnique({ where: { id: user.id }, select: { twoFactorEnabled: true } }),
  ]);
  if (
    requiresTwoFactorSetup({
      isAdmin,
      twoFactorEnabled: Boolean(row?.twoFactorEnabled),
      settingOn,
    })
  ) {
    redirect(`/${locale}/settings/security`);
  }
}
