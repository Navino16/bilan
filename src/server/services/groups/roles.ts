import { db } from "@/server/db";
import type { GroupRole } from "@/lib/validation/group";

export { GROUP_ROLES, type GroupRole } from "@/lib/validation/group";

export const RANK: Record<GroupRole, number> = { OWNER: 3, ADMIN: 2, MEMBER: 1 };

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
