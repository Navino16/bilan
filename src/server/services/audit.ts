import type { AuditLog, Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/server/db";
import { escapeLike } from "@/server/db/like";
import { ADMIN_PAGE_SIZE, pageWindow } from "@/lib/pagination";
import { AUDIT_FAMILIES } from "@/lib/audit";

export async function logEvent(input: {
  userId?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: input.userId ?? null,
      action: input.action,
      entity: input.entity ?? null,
      entityId: input.entityId ?? null,
      metadata: (input.metadata ?? {}) as never,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}

export type AuditLogFilter = {
  /** Prefix of the action code (`group` matches `group.created`). */
  action?: string;
  entity?: string;
  /** Fragment of the acting user's email or name, or an exact user id. */
  user?: string;
  /** Inclusive lower bound. */
  from?: Date;
  /** Exclusive upper bound. */
  to?: Date;
  page?: number;
  pageSize?: number;
};

type UserRef = { name: string | null; email: string };

// `user` is null for system events and for users deleted since (userId has no FK).
// `subject` is the user an entity="User" row is about, resolved the same way.
// `entityName` is the current name of an admin-domain entity (ENTITY_NAMES), null otherwise.
export type AuditEntry = AuditLog & {
  user: UserRef | null;
  subject: UserRef | null;
  entityName: string | null;
};

type Named = { id: string; name: string | null };
const byIds = (ids: string[]) => ({ where: { id: { in: ids } } });

// Admin-domain entities only: users' financial labels (accounts, categories, budgets, rules,
// imports, transactions) stay as ids so admins can't read them (#244 decision).
const ENTITY_NAMES: Record<string, (database: PrismaClient, ids: string[]) => Promise<Named[]>> = {
  Group: (d, ids) => d.group.findMany({ ...byIds(ids), select: { id: true, name: true } }),
  Passkey: (d, ids) => d.passkey.findMany({ ...byIds(ids), select: { id: true, name: true } }),
  AuthProvider: async (d, ids) =>
    (await d.authProvider.findMany({ ...byIds(ids), select: { id: true, displayName: true } })).map(
      (p) => ({ id: p.id, name: p.displayName }),
    ),
  GroupInvitation: async (d, ids) =>
    (await d.groupInvitation.findMany({ ...byIds(ids), select: { id: true, email: true } })).map(
      (i) => ({ id: i.id, name: i.email }),
    ),
  AdminSignupToken: async (d, ids) =>
    (
      await d.adminSignupToken.findMany({ ...byIds(ids), select: { id: true, description: true } })
    ).map((s) => ({ id: s.id, name: s.description })),
};

async function entityNames(
  items: AuditLog[],
  database: PrismaClient,
): Promise<Map<string, string>> {
  const idsByEntity = new Map<string, Set<string>>();
  for (const i of items) {
    if (!i.entity || !i.entityId || !Object.hasOwn(ENTITY_NAMES, i.entity)) continue;
    idsByEntity.set(i.entity, (idsByEntity.get(i.entity) ?? new Set()).add(i.entityId));
  }
  const rows = await Promise.all(
    [...idsByEntity].map(async ([entity, ids]) =>
      (await ENTITY_NAMES[entity](database, [...ids])).map((r) => [`${entity}:${r.id}`, r.name]),
    ),
  );
  return new Map(rows.flat().filter((r): r is [string, string] => !!r[1]));
}

export type AuditPage = { items: AuditEntry[]; total: number; page: number; pageCount: number };

// Paginated audit-log read for the admin viewer, newest first.
export async function listAuditLog(
  filter: AuditLogFilter = {},
  database: PrismaClient = db,
): Promise<AuditPage> {
  const pageSize = filter.pageSize ?? ADMIN_PAGE_SIZE;
  const where: Prisma.AuditLogWhereInput = {};
  if (filter.action) {
    const family = (AUDIT_FAMILIES as readonly string[]).includes(filter.action);
    where.action = { startsWith: escapeLike(family ? `${filter.action}.` : filter.action) };
  }
  if (filter.entity) where.entity = filter.entity;
  if (filter.from || filter.to) {
    where.createdAt = {
      ...(filter.from ? { gte: filter.from } : {}),
      ...(filter.to ? { lt: filter.to } : {}),
    };
  }
  const userQuery = filter.user?.trim();
  if (userQuery) {
    // AuditLog.userId has no FK (rows outlive their user), so no relation filter: the
    // matching ids are resolved first, uncapped.
    const like = escapeLike(userQuery);
    const matches = await database.user.findMany({
      where: { OR: [{ email: { contains: like } }, { name: { contains: like } }] },
      select: { id: true },
    });
    where.userId = { in: [userQuery, ...matches.map((u) => u.id)] };
  }

  const total = await database.auditLog.count({ where });
  const { page, pageCount, skip } = pageWindow(total, filter.page ?? 1, pageSize);
  const items = await database.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: pageSize,
    skip,
  });

  const ids = new Set<string>();
  for (const i of items) {
    if (i.userId) ids.add(i.userId);
    if (i.entity === "User" && i.entityId) ids.add(i.entityId);
  }
  const [users, names] = await Promise.all([
    ids.size
      ? database.user.findMany({
          where: { id: { in: [...ids] } },
          select: { id: true, name: true, email: true },
        })
      : [],
    entityNames(items, database),
  ]);
  const byId = new Map(users.map((u) => [u.id, { name: u.name, email: u.email }]));
  return {
    items: items.map((i) => ({
      ...i,
      user: i.userId ? (byId.get(i.userId) ?? null) : null,
      subject: i.entity === "User" && i.entityId ? (byId.get(i.entityId) ?? null) : null,
      entityName: names.get(`${i.entity}:${i.entityId}`) ?? null,
    })),
    total,
    page,
    pageCount,
  };
}

// Retention purge: delete audit rows older than the cutoff. Returns the count.
export async function purgeAuditOlderThan(
  cutoff: Date,
  database: PrismaClient = db,
): Promise<number> {
  const { count } = await database.auditLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return count;
}
