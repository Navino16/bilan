import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { GROUP_ROLE_RANK as RANK, type GroupRole } from "@/lib/validation/group";

export { GROUP_ROLES, type GroupRole } from "@/lib/validation/group";

export class GroupAccessError extends Error {}

export async function getMembership(
  groupId: string,
  userId: string,
): Promise<{ role: GroupRole } | null> {
  const m = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });
  return m ? { role: m.role as GroupRole } : null;
}

// Returns the actor's role if it meets `min`, else throws. A non-member throws too.
export async function requireGroupRole(
  groupId: string,
  userId: string,
  min: GroupRole,
): Promise<GroupRole> {
  const m = await getMembership(groupId, userId);
  if (!m || RANK[m.role] < RANK[min]) throw new GroupAccessError("FORBIDDEN");
  return m.role;
}

export async function countOwners(groupId: string): Promise<number> {
  return db.groupMember.count({ where: { groupId, role: "OWNER" } });
}

export type LockedMember = { userId: string; role: GroupRole };

// Shares, departures and the last-owner rule serialize on the group's membership rows (#259);
// locking reads see the latest committed rows.
export function lockGroupMembers(
  tx: Prisma.TransactionClient,
  groupId: string,
): Promise<LockedMember[]> {
  return tx.$queryRaw<LockedMember[]>`
    SELECT userId, role FROM GroupMember WHERE groupId = ${groupId} FOR UPDATE`;
}

export async function lockMember(
  tx: Prisma.TransactionClient,
  groupId: string,
  userId: string,
): Promise<LockedMember | null> {
  const rows = await tx.$queryRaw<LockedMember[]>`
    SELECT userId, role FROM GroupMember
    WHERE groupId = ${groupId} AND userId = ${userId} FOR UPDATE`;
  return rows[0] ?? null;
}
