import type { PrismaClient } from "@prisma/client";
import { logEvent } from "@/server/services/audit";

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
