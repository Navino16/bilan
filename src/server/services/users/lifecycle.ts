import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/server/db";
import { LONG_TX_TIMEOUT } from "@/server/db/timeouts";
import { logEvent } from "@/server/services/audit";
import { eraseUser, groupSuccessions, logUserDeleted } from "@/server/services/rgpd";
import { mayHandleRole, topRole, type InstanceRole } from "@/lib/instance-roles";
import { lockActiveSuperAdmins } from "@/server/services/users/roles";
import { displayName } from "@/lib/validation/name";

type Client = Prisma.TransactionClient | PrismaClient;

export type UserAdminAction = "disable" | "enable" | "delete";
export type UserAdminRefusal =
  | "SELF"
  | "FORBIDDEN"
  | "LAST_SUPER_ADMIN"
  | "NOT_FOUND"
  | "CONFIRMATION";

export class UserAdminError extends Error {
  constructor(readonly code: UserAdminRefusal) {
    super(code);
  }
}

// Only active (not disabled) super admins may act on admins or delete anyone. Since the
// actor must be one and can't target themselves, an admin action can never remove the
// last active super admin; that guard lives in deleteOwnAccount.
export function checkUserAdminAction(input: {
  action: UserAdminAction;
  actorId: string;
  actorIsActiveSuperAdmin: boolean;
  targetId: string;
  targetRole: InstanceRole;
}): UserAdminRefusal | null {
  if (input.actorId === input.targetId) return "SELF";
  if (input.action === "delete" && !input.actorIsActiveSuperAdmin) return "FORBIDDEN";
  if (!mayHandleRole(input.actorIsActiveSuperAdmin, input.targetRole)) return "FORBIDDEN";
  return null;
}

async function authorize(
  tx: Prisma.TransactionClient,
  action: UserAdminAction,
  actorId: string,
  targetId: string,
): Promise<{ email: string }> {
  const activeSuperAdmins = await lockActiveSuperAdmins(tx);
  const target = await tx.user.findUnique({
    where: { id: targetId },
    select: { email: true, roles: { select: { role: { select: { key: true } } } } },
  });
  if (!target) throw new UserAdminError("NOT_FOUND");
  const refusal = checkUserAdminAction({
    action,
    actorId,
    actorIsActiveSuperAdmin: activeSuperAdmins.includes(actorId),
    targetId,
    targetRole: topRole(target.roles.map((r) => r.role.key)),
  });
  if (refusal) throw new UserAdminError(refusal);
  return { email: target.email };
}

// Disabling uses the Better Auth admin plugin's ban fields: its session-create hook then
// refuses every sign-in method, and deleting the sessions ends the open ones.
export async function setUserDisabled(
  actor: { id: string },
  targetId: string,
  disabled: boolean,
  database: PrismaClient = db,
): Promise<void> {
  const changed = await database.$transaction(async (tx) => {
    await authorize(tx, disabled ? "disable" : "enable", actor.id, targetId);
    const { count } = await tx.user.updateMany({
      where: { id: targetId, banned: !disabled },
      data: { banned: disabled, banReason: disabled ? "admin" : null, banExpires: null },
    });
    if (disabled) await tx.session.deleteMany({ where: { userId: targetId } });
    return count > 0;
  });
  if (changed) {
    await logEvent({
      userId: actor.id,
      action: disabled ? "user.disabled" : "user.enabled",
      entity: "User",
      entityId: targetId,
    });
  }
}

export type UserDeletionImpact = {
  email: string;
  accounts: number;
  sharedAccounts: number;
  transfers: { group: string; to: string }[];
  deletedGroups: string[];
  // Surviving budget lines restricted to one of the user's accounts: they lose that restriction
  // (BudgetLine.account onDelete SetNull).
  budgetLines: number;
};

// Shown in the admin's confirmation before deleting: same succession rule as eraseUser.
export async function userDeletionImpact(
  targetId: string,
  database: Client = db,
): Promise<UserDeletionImpact | null> {
  const user = await database.user.findUnique({ where: { id: targetId }, select: { email: true } });
  if (!user) return null;
  const [accounts, sharedAccounts, successions] = await Promise.all([
    database.bankAccount.count({ where: { ownerId: targetId } }),
    database.bankAccount.count({ where: { ownerId: targetId, shares: { some: {} } } }),
    groupSuccessions(database, targetId),
  ]);
  const deleted = successions.filter((s) => !s.successor);
  const budgetLines = await database.budgetLine.count({
    where: {
      account: { ownerId: targetId },
      budget: {
        AND: [
          { OR: [{ userId: null }, { userId: { not: targetId } }] },
          { OR: [{ groupId: null }, { groupId: { notIn: deleted.map((s) => s.groupId) } }] },
        ],
      },
    },
  });
  return {
    email: user.email,
    accounts,
    sharedAccounts,
    transfers: successions
      .filter((s) => s.successor && !s.successorIsOwner)
      .map((s) => ({ group: s.groupName, to: displayName(s.successor!) })),
    deletedGroups: deleted.map((s) => s.groupName),
    budgetLines,
  };
}

// Permanent deletion by a super admin, checked and erased in one transaction.
// `confirmEmail` is the target's address typed back by the admin.
export async function adminDeleteUser(
  actor: { id: string },
  targetId: string,
  confirmEmail: string,
  database: PrismaClient = db,
): Promise<void> {
  await database.$transaction(async (tx) => {
    const { email } = await authorize(tx, "delete", actor.id, targetId);
    if (confirmEmail.trim().toLowerCase() !== email.toLowerCase()) {
      throw new UserAdminError("CONFIRMATION");
    }
    await eraseUser(tx, targetId);
  }, LONG_TX_TIMEOUT);
  await logUserDeleted(targetId, actor);
}

// RGPD self-deletion; the last active super admin can't leave the instance unadministered.
export async function deleteOwnAccount(userId: string, database: PrismaClient = db): Promise<void> {
  await database.$transaction(async (tx) => {
    const active = await lockActiveSuperAdmins(tx);
    if (active.includes(userId) && active.length === 1) {
      throw new UserAdminError("LAST_SUPER_ADMIN");
    }
    await eraseUser(tx, userId);
  }, LONG_TX_TIMEOUT);
  await logUserDeleted(userId, { id: userId });
}
