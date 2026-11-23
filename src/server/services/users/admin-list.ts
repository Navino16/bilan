import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/server/db";
import { escapeLike } from "@/server/db/like";
import { ADMIN_PAGE_SIZE, pageWindow } from "@/lib/pagination";

export type AdminUserRow = {
  id: string;
  name: string | null;
  email: string;
  roleKeys: string[];
  disabled: boolean;
  emailVerified: boolean;
};

// Admin user list, newest first, searchable on name/email (case-insensitive collation).
export async function listUsersForAdmin(
  opts: { q?: string; page?: number; pageSize?: number } = {},
  database: PrismaClient = db,
): Promise<{ items: AdminUserRow[]; total: number; page: number; pageCount: number }> {
  const pageSize = opts.pageSize ?? ADMIN_PAGE_SIZE;
  const q = opts.q?.trim();
  const like = q && escapeLike(q);
  const where: Prisma.UserWhereInput = like
    ? { OR: [{ email: { contains: like } }, { name: { contains: like } }] }
    : {};
  const total = await database.user.count({ where });
  const { page, pageCount, skip } = pageWindow(total, opts.page ?? 1, pageSize);
  const users = await database.user.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    skip,
    take: pageSize,
    select: {
      id: true,
      name: true,
      email: true,
      banned: true,
      emailVerified: true,
      roles: { select: { role: { select: { key: true } } } },
    },
  });
  return {
    items: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      roleKeys: u.roles.map((r) => r.role.key),
      disabled: u.banned,
      emailVerified: u.emailVerified,
    })),
    total,
    page,
    pageCount,
  };
}
