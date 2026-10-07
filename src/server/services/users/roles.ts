import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import { INSTANCE_ROLES, topRole, type InstanceRole } from "@/lib/instance-roles";

export async function grantRole(
  db: PrismaClient,
  userId: string,
  roleKey: string,
  grantedBy: string | null = null,
): Promise<void> {
  const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
  const existing = await db.userRole.findUnique({
    where: { userId_roleId: { userId, roleId: role.id } },
  });
  await db.userRole.upsert({
    where: { userId_roleId: { userId, roleId: role.id } },
    create: { userId, roleId: role.id, grantedBy },
    update: {},
  });
  // Audit only a real (new) grant, not an idempotent re-grant.
  if (!existing) {
    await logEvent({
      userId: grantedBy,
      action: "user.role.granted",
      entity: "User",
      entityId: userId,
      metadata: { roleKey },
    });
  }
}

export type RoleChangeRefusal = "SELF" | "FORBIDDEN" | "LAST_SUPER_ADMIN";

export class RoleChangeError extends Error {}

export function checkRoleChange(input: {
  actorId: string;
  actorIsSuperAdmin: boolean;
  targetId: string;
  from: InstanceRole;
  to: InstanceRole;
  otherActiveSuperAdmins: number;
}): RoleChangeRefusal | null {
  if (input.actorId === input.targetId) return "SELF";
  const touchesAdmin = [input.from, input.to].some((r) => r !== "USER");
  if (touchesAdmin && !input.actorIsSuperAdmin) return "FORBIDDEN";
  if (
    input.from === "SUPER_ADMIN" &&
    input.to !== "SUPER_ADMIN" &&
    input.otherActiveSuperAdmins === 0
  ) {
    return "LAST_SUPER_ADMIN";
  }
  return null;
}

// Locks the SUPER_ADMIN role rows so concurrent actions between super admins are
// serialised, and returns the active (not disabled) ones.
export async function lockActiveSuperAdmins(tx: Prisma.TransactionClient): Promise<string[]> {
  const locked = await tx.$queryRaw<{ userId: string }[]>`
    SELECT ur.userId FROM UserRole ur JOIN Role r ON r.id = ur.roleId
    WHERE r.\`key\` = 'SUPER_ADMIN' FOR UPDATE`;
  const active = await tx.user.findMany({
    where: { id: { in: locked.map((s) => s.userId) }, banned: false },
    select: { id: true },
  });
  return active.map((u) => u.id);
}

// Replaces the target's instance role. Disabled super admins count neither as actors nor
// toward the last-super-admin guard.
export async function setUserRole(
  actor: { id: string },
  userId: string,
  to: InstanceRole,
  database: PrismaClient = db,
): Promise<void> {
  const from = await database.$transaction(async (tx) => {
    const superAdmins = await lockActiveSuperAdmins(tx);
    const target = await tx.user.findUnique({
      where: { id: userId },
      select: { roles: { select: { role: { select: { key: true } } } } },
    });
    if (!target) throw new RoleChangeError("NOT_FOUND");

    const from = topRole(target.roles.map((r) => r.role.key));
    const refusal = checkRoleChange({
      actorId: actor.id,
      actorIsSuperAdmin: superAdmins.includes(actor.id),
      targetId: userId,
      from,
      to,
      otherActiveSuperAdmins: superAdmins.filter((id) => id !== userId).length,
    });
    if (refusal) throw new RoleChangeError(refusal);
    if (from === to) return null;

    const role = await tx.role.findUniqueOrThrow({ where: { key: to } });
    await tx.userRole.deleteMany({
      where: { userId, role: { key: { in: [...INSTANCE_ROLES] } } },
    });
    await tx.userRole.create({ data: { userId, roleId: role.id, grantedBy: actor.id } });
    return from;
  });

  if (from) {
    await logEvent({
      userId: actor.id,
      action: "user.role.changed",
      entity: "User",
      entityId: userId,
      metadata: { from, to },
    });
  }
}
