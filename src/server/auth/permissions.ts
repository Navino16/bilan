import { cache } from "react";
import type { PrismaClient } from "@prisma/client";
import { headers as nextHeaders } from "next/headers";
import { authHeaders } from "@/server/http/auth-headers";
import { redirect, forbidden } from "next/navigation";
import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { appSettings } from "@/server/services/settings/app-settings";
import {
  loginRedirectPath,
  pathLocale,
  REQUEST_PATH_HEADER,
  safeCallbackPath,
} from "@/lib/callback-url";

export function buildPermissionsChecker(database: PrismaClient) {
  // Memoized per server render: the layouts and the page each check permissions.
  const permissionKeysOf = cache(async (userId: string): Promise<ReadonlySet<string>> => {
    const user = await database.user.findUnique({
      where: { id: userId },
      include: {
        roles: {
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        },
      },
    });
    if (!user || user.banned) return new Set();
    return new Set(user.roles.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.key)));
  });
  return async function hasPermission(userId: string, permissionKey: string): Promise<boolean> {
    return (await permissionKeysOf(userId)).has(permissionKey);
  };
}

export const hasPermission = buildPermissionsChecker(db);

// A session created while its user was being disabled may survive the session purge:
// a disabled user is treated as signed out regardless (users/lifecycle.ts).
export function activeSession<S extends { user: object }>(session: S | null): S | null {
  return session && !(session.user as { banned?: boolean | null }).banned ? session : null;
}

// Per-request memo: with the cookie cache off, every lookup is a DB round-trip.
export const getCurrentSession = cache(async () => {
  const auth = await getAuth();
  return activeSession(await auth.api.getSession({ headers: await authHeaders() }));
});

export async function getCurrentUser() {
  return (await getCurrentSession())?.user ?? null;
}

export async function requireSession() {
  const user = await getCurrentUser();
  if (!user) {
    const target = safeCallbackPath((await nextHeaders()).get(REQUEST_PATH_HEADER));
    redirect(target ? loginRedirectPath(pathLocale(target), target) : "/login");
  }
  return user;
}

export async function requirePermission(permissionKey: string) {
  const user = await requireSession();
  const ok = await hasPermission(user.id, permissionKey);
  // Real 403 via the auth-interrupt → nearest forbidden.tsx (not a redirect).
  if (!ok) forbidden();
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
