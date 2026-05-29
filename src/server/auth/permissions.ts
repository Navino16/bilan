import type { PrismaClient } from "@prisma/client";
import { headers as nextHeaders } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { getAuth } from "@/server/auth";

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
