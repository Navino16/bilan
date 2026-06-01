import type { PrismaClient } from "@prisma/client";

export async function grantRole(
  db: PrismaClient,
  userId: string,
  roleKey: string,
  grantedBy: string | null = null,
): Promise<void> {
  const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
  await db.userRole.upsert({
    where: { userId_roleId: { userId, roleId: role.id } },
    create: { userId, roleId: role.id, grantedBy },
    update: {},
  });
}
