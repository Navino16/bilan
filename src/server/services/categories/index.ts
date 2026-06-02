import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import { requireGroupRole } from "@/server/services/groups/roles";
import { categoryInputSchema, type CategoryInput } from "@/lib/validation/category";

export class CategoryAccessError extends Error {}

export type CategoryScope = "USER" | "GROUP";

export type CategoryNode = {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  parentId: string | null;
  scope: CategoryScope;
  groupId: string | null;
  isDefault: boolean;
  children: CategoryNode[];
};

// Authorizes the actor for a given owner scope: personal categories require the
// category to belong to the actor; group categories require ADMIN+ in the group.
async function assertCanManageScope(groupId: string | undefined, actorId: string): Promise<void> {
  if (groupId) {
    try {
      await requireGroupRole(groupId, actorId, "ADMIN");
    } catch {
      throw new CategoryAccessError("FORBIDDEN");
    }
  }
}

export async function createCategory(
  input: CategoryInput,
  actor: { id: string },
): Promise<{ id: string }> {
  const data = categoryInputSchema.parse(input);
  await assertCanManageScope(data.groupId, actor.id);

  // A parent (if any) must live in the same owner scope.
  if (data.parentId) {
    const parent = await db.category.findUnique({ where: { id: data.parentId } });
    if (!parent) throw new CategoryAccessError("INVALID_PARENT");
    const sameScope = data.groupId ? parent.groupId === data.groupId : parent.userId === actor.id;
    if (!sameScope) throw new CategoryAccessError("INVALID_PARENT");
  }

  const cat = await db.category.create({
    data: {
      name: data.name,
      color: data.color ?? null,
      icon: data.icon ?? null,
      parentId: data.parentId ?? null,
      userId: data.groupId ? null : actor.id,
      groupId: data.groupId ?? null,
    },
  });
  await logEvent({
    userId: actor.id,
    action: "category.created",
    entity: "Category",
    entityId: cat.id,
  });
  return { id: cat.id };
}

async function ownedOrThrow(id: string, actorId: string) {
  const cat = await db.category.findUnique({ where: { id } });
  if (!cat) throw new CategoryAccessError("NOT_FOUND");
  if (cat.groupId) {
    try {
      await requireGroupRole(cat.groupId, actorId, "ADMIN");
    } catch {
      throw new CategoryAccessError("FORBIDDEN");
    }
  } else if (cat.userId !== actorId) {
    throw new CategoryAccessError("FORBIDDEN");
  }
  return cat;
}

export async function updateCategory(
  id: string,
  input: CategoryInput,
  actor: { id: string },
): Promise<void> {
  const existing = await ownedOrThrow(id, actor.id);
  const data = categoryInputSchema.parse(input);
  await db.category.update({
    where: { id },
    data: {
      name: data.name,
      color: data.color ?? null,
      icon: data.icon ?? null,
      // Reparenting within the same scope only; ignore groupId changes (scope is immutable).
      parentId: data.parentId && data.parentId !== id ? data.parentId : null,
    },
  });
  await logEvent({
    userId: actor.id,
    action: "category.updated",
    entity: "Category",
    entityId: existing.id,
  });
}

export async function deleteCategory(id: string, actor: { id: string }): Promise<void> {
  const existing = await ownedOrThrow(id, actor.id);
  // Children become roots (onDelete: SetNull); transactions keep categoryId null (set in 3.2 schema).
  await db.category.delete({ where: { id } });
  await logEvent({
    userId: actor.id,
    action: "category.deleted",
    entity: "Category",
    entityId: existing.id,
  });
}

function buildTree(
  rows: {
    id: string;
    name: string;
    color: string | null;
    icon: string | null;
    parentId: string | null;
    userId: string | null;
    groupId: string | null;
    isDefault: boolean;
  }[],
): CategoryNode[] {
  const byId = new Map<string, CategoryNode>();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id,
      name: r.name,
      color: r.color,
      icon: r.icon,
      parentId: r.parentId,
      scope: r.groupId ? "GROUP" : "USER",
      groupId: r.groupId,
      isDefault: r.isDefault,
      children: [],
    });
  }
  const roots: CategoryNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortRec = (nodes: CategoryNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

// All categories the user can use: their personal ones + every category owned
// by a group they belong to. Returned as a parent/child forest.
export async function listForUser(userId: string): Promise<CategoryNode[]> {
  const memberships = await db.groupMember.findMany({
    where: { userId },
    select: { groupId: true },
  });
  const groupIds = memberships.map((m) => m.groupId);
  const rows = await db.category.findMany({
    where: { OR: [{ userId }, { groupId: { in: groupIds } }] },
    orderBy: { name: "asc" },
  });
  return buildTree(rows);
}
