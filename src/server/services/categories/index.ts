import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { LONG_TX_TIMEOUT } from "@/server/db/timeouts";
import { logEvent } from "@/server/services/audit";
import { requireGroupRole } from "@/server/services/groups/roles";
import { groupMemberships } from "@/server/services/groups/memberships";
import { visibleAccountIds } from "@/server/services/accounts";
import {
  syncAutoPeriodDates,
  syncAutoPeriodDatesBeforeMove,
} from "@/server/services/transactions/period-date";
import { categoryInputSchema, type CategoryInput } from "@/lib/schemas/category";

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
  shiftDays: number | null;
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

// Throws unless `categoryId` is one the actor may legitimately attach to their
// data — a personal category they own, or a category of a group they belong to
// (the same set `listForUser` exposes). `null`/`undefined` means "no category"
// and is always allowed. Guards against forged `categoryId`s that bypass the
// UI's own-categories-only pickers (e.g. tagging a transaction or rule with
// another user's private category).
export async function assertCategoryAssignable(
  categoryId: string | null | undefined,
  actorId: string,
): Promise<void> {
  if (!categoryId) return;
  const cat = await db.category.findUnique({
    where: { id: categoryId },
    select: { userId: true, groupId: true },
  });
  if (!cat) throw new CategoryAccessError("INVALID_CATEGORY");
  if (cat.userId === actorId) return;
  if (cat.groupId) {
    const member = await db.groupMember.findUnique({
      where: { groupId_userId: { groupId: cat.groupId, userId: actorId } },
    });
    if (member) return;
  }
  throw new CategoryAccessError("INVALID_CATEGORY");
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
      shiftDays: data.shiftDays ?? null,
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

// Validates a proposed new parent for category `id`: it must exist, share the
// node's owner scope, and not be a descendant of `id` (a cycle, which would
// orphan the whole branch out of `buildTree` and make it vanish from the list).
async function assertValidParent(
  id: string,
  parentId: string,
  node: { userId: string | null; groupId: string | null },
): Promise<void> {
  const parent = await db.category.findUnique({
    where: { id: parentId },
    select: { userId: true, groupId: true, parentId: true },
  });
  if (!parent) throw new CategoryAccessError("INVALID_PARENT");
  const sameScope = node.groupId ? parent.groupId === node.groupId : parent.userId === node.userId;
  if (!sameScope) throw new CategoryAccessError("INVALID_PARENT");
  // Walk up from the proposed parent; reaching `id` means parentId is a descendant.
  let cursor: string | null = parent.parentId;
  const seen = new Set<string>([parentId]);
  while (cursor) {
    if (cursor === id) throw new CategoryAccessError("INVALID_PARENT");
    if (seen.has(cursor)) break; // defensive: stop on any pre-existing cycle
    seen.add(cursor);
    const up = await db.category.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    cursor = up?.parentId ?? null;
  }
}

export async function updateCategory(
  id: string,
  input: CategoryInput,
  actor: { id: string },
): Promise<void> {
  const existing = await ownedOrThrow(id, actor.id);
  const data = categoryInputSchema.parse(input);
  const parentId = data.parentId && data.parentId !== id ? data.parentId : null;
  if (parentId) await assertValidParent(id, parentId, existing);
  const shiftDays = data.shiftDays ?? null;
  await db.$transaction(async (tx) => {
    await tx.category.update({
      where: { id },
      data: {
        name: data.name,
        color: data.color ?? null,
        icon: data.icon ?? null,
        // Reparenting within the same scope only; ignore groupId changes (scope is immutable).
        parentId,
        shiftDays,
      },
    });
    if (shiftDays !== existing.shiftDays) await syncAutoPeriodDates({ categoryIds: [id] }, tx);
  }, LONG_TX_TIMEOUT);
  await logEvent({
    userId: actor.id,
    action: "category.updated",
    entity: "Category",
    entityId: existing.id,
  });
}

// Maps each id to itself + all its descendants, walking down one level per query.
export async function withDescendants(
  ids: string[],
  client: Prisma.TransactionClient = db,
): Promise<Map<string, Set<string>>> {
  const childrenOf = new Map<string, string[]>();
  const seen = new Set(ids);
  let frontier = [...seen];
  while (frontier.length > 0) {
    const kids = await client.category.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true, parentId: true },
    });
    frontier = [];
    for (const k of kids) {
      childrenOf.set(k.parentId!, [...(childrenOf.get(k.parentId!) ?? []), k.id]);
      if (!seen.has(k.id)) {
        seen.add(k.id);
        frontier.push(k.id);
      }
    }
  }
  const out = new Map<string, Set<string>>();
  for (const id of ids) {
    const subtree = new Set<string>();
    const stack = [id];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (subtree.has(cur)) continue;
      subtree.add(cur);
      stack.push(...(childrenOf.get(cur) ?? []));
    }
    out.set(id, subtree);
  }
  return out;
}

async function subtreeIds(id: string, client: Prisma.TransactionClient = db): Promise<string[]> {
  return [...(await withDescendants([id], client)).get(id)!];
}

export type CategoryDeletionImpact = {
  subcategories: number;
  transactions: number;
  rules: number;
  budgetLines: number;
};

export async function getCategoryDeletionImpact(
  id: string,
  actor: { id: string },
): Promise<CategoryDeletionImpact> {
  await ownedOrThrow(id, actor.id);
  const ids = await subtreeIds(id);
  const where = { categoryId: { in: ids } };
  const [transactions, rules, budgetLines] = await Promise.all([
    db.transaction.count({ where }),
    db.categorizationRule.count({ where }),
    db.budgetLine.count({ where }),
  ]);
  return { subcategories: ids.length - 1, transactions, rules, budgetLines };
}

// Deletes the category with its whole subtree (spec: #154). With a `targetId`,
// transactions, rules and budget lines of the subtree move to it; without one,
// transactions become uncategorized and rules / budget lines are deleted.
export async function deleteCategory(
  id: string,
  actor: { id: string },
  opts: { targetId?: string | null } = {},
): Promise<void> {
  const existing = await ownedOrThrow(id, actor.id);
  const targetId = opts.targetId || null;
  const impact = await db.$transaction(async (tx) => {
    const ids = await subtreeIds(id, tx);
    if (targetId) {
      if (ids.includes(targetId)) throw new CategoryAccessError("INVALID_TARGET");
      const target = await tx.category.findUnique({
        where: { id: targetId },
        select: { userId: true, groupId: true },
      });
      const sameScope =
        target &&
        (existing.groupId
          ? target.groupId === existing.groupId
          : target.groupId === null && target.userId === existing.userId);
      if (!sameScope) throw new CategoryAccessError("INVALID_TARGET");
    }
    const where = { categoryId: { in: ids } };
    await syncAutoPeriodDatesBeforeMove(ids, targetId, tx);
    const transactions = await tx.transaction.updateMany({
      where,
      data: { categoryId: targetId },
    });
    const rules = targetId
      ? await tx.categorizationRule.updateMany({ where, data: { categoryId: targetId } })
      : await tx.categorizationRule.deleteMany({ where });
    const budgetLines = targetId
      ? await tx.budgetLine.updateMany({ where, data: { categoryId: targetId } })
      : await tx.budgetLine.deleteMany({ where });
    await tx.category.deleteMany({ where: { id: { in: ids } } });
    return {
      subcategories: ids.length - 1,
      transactions: transactions.count,
      rules: rules.count,
      budgetLines: budgetLines.count,
    };
  }, LONG_TX_TIMEOUT);
  await logEvent({
    userId: actor.id,
    action: "category.deleted",
    entity: "Category",
    entityId: existing.id,
    metadata: { ...impact, targetId },
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
    shiftDays: number | null;
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
      shiftDays: r.shiftDays,
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
// by a group they belong to. `client` lets a transaction read the same set.
export async function loadAssignableCategories(
  client: Prisma.TransactionClient,
  userId: string,
  memberships?: readonly { groupId: string }[],
) {
  const groupIds = (
    memberships ??
    (await client.groupMember.findMany({ where: { userId }, select: { groupId: true } }))
  ).map((m) => m.groupId);
  return client.category.findMany({
    where: { OR: [{ userId }, { groupId: { in: groupIds } }] },
    orderBy: { name: "asc" },
  });
}

// `loadAssignableCategories` as a parent/child forest. Memoized per server
// render: pages also reach it through listForeignCategories.
export const listForUser = cache(
  async (userId: string): Promise<CategoryNode[]> =>
    buildTree(await loadAssignableCategories(db, userId, await groupMemberships(userId))),
);

// Categories the user can't use but meets on the transactions they can see
// (an owner's personal ones on a shared account), plus their ancestors for
// colour inheritance. Display only: never offered in a picker (#159).
// `alsoIds`: categories met elsewhere, e.g. on a private transaction counted in a household budget.
export async function listForeignCategories(
  userId: string,
  { alsoIds = [] }: { alsoIds?: string[] } = {},
): Promise<CategoryNode[]> {
  const own = await listForUser(userId);
  const known = new Set<string>();
  const collect = (nodes: CategoryNode[]): void => {
    for (const n of nodes) {
      known.add(n.id);
      collect(n.children);
    }
  };
  collect(own);
  // Archived accounts included: budgets still show their transactions.
  const used = await db.transaction.groupBy({
    by: ["categoryId"],
    where: {
      categoryId: { not: null, notIn: [...known] },
      accountId: { in: await visibleAccountIds(userId) },
    },
  });
  let missing = [
    ...new Set([...used.map((u) => u.categoryId!), ...alsoIds.filter((id) => !known.has(id))]),
  ];
  const rows: Parameters<typeof buildTree>[0] = [];
  while (missing.length > 0) {
    const found = await db.category.findMany({ where: { id: { in: missing } } });
    found.forEach((c) => known.add(c.id));
    rows.push(...found);
    missing = [
      ...new Set(found.flatMap((c) => (c.parentId && !known.has(c.parentId) ? [c.parentId] : []))),
    ];
  }
  return buildTree(rows);
}
