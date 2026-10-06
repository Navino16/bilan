import type { AuditLog, PrismaClient } from "@prisma/client";
import { db } from "@/server/db";

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
  action?: string;
  entity?: string;
  userId?: string;
  take?: number;
  skip?: number;
};

// `user` is null for system events and for users deleted since (userId has no FK).
export type AuditEntry = AuditLog & { user: { name: string | null; email: string } | null };

// Paginated audit-log read for the admin viewer, newest first.
export async function listAuditLog(
  filter: AuditLogFilter = {},
  database: PrismaClient = db,
): Promise<{ items: AuditEntry[]; total: number }> {
  const where = {
    ...(filter.action ? { action: filter.action } : {}),
    ...(filter.entity ? { entity: filter.entity } : {}),
    ...(filter.userId ? { userId: filter.userId } : {}),
  };
  const [items, total] = await Promise.all([
    database.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: filter.take ?? 50,
      skip: filter.skip ?? 0,
    }),
    database.auditLog.count({ where }),
  ]);
  const ids = [...new Set(items.flatMap((i) => (i.userId ? [i.userId] : [])))];
  const users = ids.length
    ? await database.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const byId = new Map(users.map((u) => [u.id, { name: u.name, email: u.email }]));
  return {
    items: items.map((i) => ({ ...i, user: i.userId ? (byId.get(i.userId) ?? null) : null })),
    total,
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
