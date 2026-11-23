import { cache } from "react";
import type { PrismaClient } from "@prisma/client";
import { headers as nextHeaders } from "next/headers";
import { authHeaders } from "@/server/http/auth-headers";
import { redirect, forbidden } from "next/navigation";
import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { appSettings } from "@/server/services/settings/app-settings";
import { hasPasswordCredential } from "@/server/services/users/password";
import { defaultLocale } from "@/i18n/config";
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

// Spec §6.11: once the instance requires it, admin permissions are void until their holder
// enrols 2FA. Every admin gate (pages, RSC requests, Server Actions) goes through here.
const adminTwoFactorMissing = cache(async (userId: string): Promise<boolean> => {
  const [settingOn, passwordSignIn, row, hasPassword] = await Promise.all([
    appSettings.get<boolean>("security.admin_2fa_required").then((v) => v ?? false),
    appSettings.get<boolean>("credentials_enabled").then((v) => v ?? true),
    db.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true } }),
    hasPasswordCredential(userId),
  ]);
  return requiresTwoFactorSetup({
    isAdmin: true,
    twoFactorEnabled: Boolean(row?.twoFactorEnabled),
    hasPassword,
    passwordSignIn,
    settingOn,
  });
});

export async function isAdminTwoFactorBlocked(userId: string): Promise<boolean> {
  if (!(await adminTwoFactorMissing(userId))) return false;
  const adminRole = await db.userRole.findFirst({
    where: {
      userId,
      role: { permissions: { some: { permission: { key: { startsWith: "admin." } } } } },
    },
    select: { roleId: true },
  });
  return adminRole !== null;
}

function isAdminPermission(permissionKey: string): boolean {
  return permissionKey.startsWith("admin.");
}

// For Server Actions that report a refusal instead of redirecting.
export async function hasEnforcedPermission(
  userId: string,
  permissionKey: string,
): Promise<boolean> {
  if (!(await hasPermission(userId, permissionKey))) return false;
  return !isAdminPermission(permissionKey) || !(await adminTwoFactorMissing(userId));
}

export async function requirePermission(permissionKey: string) {
  const user = await requireSession();
  const ok = await hasPermission(user.id, permissionKey);
  // Real 403 via the auth-interrupt → nearest forbidden.tsx (not a redirect).
  if (!ok) forbidden();
  if (isAdminPermission(permissionKey) && (await adminTwoFactorMissing(user.id))) {
    const target = safeCallbackPath((await nextHeaders()).get(REQUEST_PATH_HEADER));
    redirect(`/${target ? pathLocale(target) : defaultLocale}/settings/security`);
  }
  return user;
}

// Pure gate predicate (spec §6.11): an admin must set up 2FA before using the admin area
// once the instance requires it. Bilan's 2FA only guards password sign-ins, so an account
// without a password, or any account while password sign-in is off, is exempt (#256).
export function requiresTwoFactorSetup(input: {
  isAdmin: boolean;
  twoFactorEnabled: boolean;
  hasPassword: boolean;
  passwordSignIn: boolean;
  settingOn: boolean;
}): boolean {
  return (
    input.isAdmin &&
    input.settingOn &&
    input.hasPassword &&
    input.passwordSignIn &&
    !input.twoFactorEnabled
  );
}
