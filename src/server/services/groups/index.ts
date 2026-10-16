import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import { nameSchema } from "@/lib/validation/name";
import { GROUP_DESCRIPTION_MAX, canRemoveMember } from "@/lib/validation/group";
import {
  GROUP_ROLES,
  GroupAccessError,
  type GroupRole,
  countOwners,
  getMembership,
  requireGroupRole,
} from "./roles";

export { GroupAccessError } from "./roles";

function groupName(raw: string): string {
  const r = nameSchema.safeParse(raw);
  if (!r.success) throw new GroupAccessError("INVALID");
  return r.data;
}

function groupDescription(raw: string | undefined): string | null {
  const v = raw?.trim() || null;
  if (v && v.length > GROUP_DESCRIPTION_MAX) throw new GroupAccessError("INVALID");
  return v;
}

export async function createGroup(
  input: { name: string; description?: string },
  ownerId: string,
): Promise<{ id: string }> {
  const name = groupName(input.name);
  const group = await db.group.create({
    data: {
      name,
      description: groupDescription(input.description),
      createdById: ownerId,
      members: { create: { userId: ownerId, role: "OWNER" } },
    },
  });
  await logEvent({ userId: ownerId, action: "group.created", entity: "Group", entityId: group.id });
  return { id: group.id };
}

export async function listGroupsForUser(userId: string) {
  const memberships = await db.groupMember.findMany({
    where: { userId, group: { archived: false } },
    include: { group: { include: { _count: { select: { members: true } } } } },
    orderBy: { joinedAt: "asc" },
  });
  return memberships.map((m) => ({
    id: m.groupId,
    name: m.group.name,
    description: m.group.description,
    role: m.role as GroupRole,
    memberCount: m.group._count.members,
  }));
}

export async function getGroupDetail(groupId: string, userId: string) {
  await requireGroupRole(groupId, userId, "MEMBER");
  const group = await db.group.findUniqueOrThrow({
    where: { id: groupId },
    include: { members: { include: { user: true }, orderBy: { joinedAt: "asc" } } },
  });
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    members: group.members.map((m) => ({
      userId: m.userId,
      role: m.role as GroupRole,
      name: m.user.name,
      email: m.user.email,
    })),
  };
}

export async function updateGroup(
  groupId: string,
  input: { name?: string; description?: string },
  actor: { id: string },
): Promise<void> {
  await requireGroupRole(groupId, actor.id, "ADMIN");
  const data = {
    ...(input.name !== undefined ? { name: groupName(input.name) } : {}),
    ...(input.description !== undefined
      ? { description: groupDescription(input.description) }
      : {}),
  };
  await db.group.update({ where: { id: groupId }, data });
  await logEvent({ userId: actor.id, action: "group.updated", entity: "Group", entityId: groupId });
}

export type GroupDeletionImpact = {
  shares: number;
  categories: number;
  rules: number;
  budgets: number;
  // Transactions filed under one of the household's categories: they become uncategorized.
  uncategorized: number;
};

// Shown in the owner's confirmation before deleteGroup: shares, categories, rules and
// budgets cascade with the group; Transaction.category is SetNull.
export async function groupDeletionImpact(
  groupId: string,
  actor: { id: string },
): Promise<GroupDeletionImpact> {
  await requireGroupRole(groupId, actor.id, "OWNER");
  const [shares, categories, rules, budgets, uncategorized] = await Promise.all([
    db.accountShare.count({ where: { groupId } }),
    db.category.count({ where: { groupId } }),
    db.categorizationRule.count({ where: { groupId } }),
    db.budget.count({ where: { groupId } }),
    db.transaction.count({ where: { category: { groupId } } }),
  ]);
  return { shares, categories, rules, budgets, uncategorized };
}

export async function deleteGroup(groupId: string, actor: { id: string }): Promise<void> {
  await requireGroupRole(groupId, actor.id, "OWNER");
  await db.group.delete({ where: { id: groupId } });
  await logEvent({ userId: actor.id, action: "group.deleted", entity: "Group", entityId: groupId });
}

export async function changeMemberRole(
  groupId: string,
  targetUserId: string,
  role: GroupRole,
  actor: { id: string },
): Promise<void> {
  if (!GROUP_ROLES.includes(role)) throw new GroupAccessError("INVALID");
  await requireGroupRole(groupId, actor.id, "OWNER");
  const target = await getMembership(groupId, targetUserId);
  if (!target) throw new GroupAccessError("NOT_MEMBER");
  if (target.role === "OWNER" && role !== "OWNER" && (await countOwners(groupId)) <= 1) {
    throw new GroupAccessError("LAST_OWNER");
  }
  await db.groupMember.update({
    where: { groupId_userId: { groupId, userId: targetUserId } },
    data: { role },
  });
  await logEvent({
    userId: actor.id,
    action: "group.member.role_changed",
    entity: "Group",
    entityId: groupId,
    metadata: { targetUserId, role },
  });
}

export async function removeMember(
  groupId: string,
  targetUserId: string,
  actor: { id: string },
): Promise<void> {
  const actorRole = await requireGroupRole(groupId, actor.id, "ADMIN");
  const target = await getMembership(groupId, targetUserId);
  if (!target) throw new GroupAccessError("NOT_MEMBER");
  if (!canRemoveMember(actorRole, target.role)) throw new GroupAccessError("FORBIDDEN");
  if (target.role === "OWNER" && (await countOwners(groupId)) <= 1) {
    throw new GroupAccessError("LAST_OWNER");
  }
  await db.groupMember.delete({ where: { groupId_userId: { groupId, userId: targetUserId } } });
  await logEvent({
    userId: actor.id,
    action: "group.member.removed",
    entity: "Group",
    entityId: groupId,
    metadata: { targetUserId },
  });
}

export async function leaveGroup(groupId: string, userId: string): Promise<void> {
  const m = await getMembership(groupId, userId);
  if (!m) throw new GroupAccessError("NOT_MEMBER");
  if (m.role === "OWNER" && (await countOwners(groupId)) <= 1) {
    throw new GroupAccessError("LAST_OWNER");
  }
  await db.groupMember.delete({ where: { groupId_userId: { groupId, userId } } });
  await logEvent({
    userId,
    action: "group.member.removed",
    entity: "Group",
    entityId: groupId,
    metadata: { targetUserId: userId, self: true },
  });
}
