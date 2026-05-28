import { PrismaClient } from "@prisma/client";

const PERMISSIONS = [
  { key: "admin.settings.write", scope: "admin", description: "Edit app settings" },
  { key: "admin.users.read", scope: "admin", description: "View users" },
  { key: "admin.users.create", scope: "admin", description: "Create users" },
  { key: "admin.signup_tokens.manage", scope: "admin", description: "Manage signup tokens" },
  { key: "admin.audit.read", scope: "admin", description: "View audit log" },
];

const ROLES: Record<string, string[]> = {
  SUPER_ADMIN: PERMISSIONS.map((p) => p.key),
  ADMIN: ["admin.settings.write", "admin.users.read", "admin.users.create", "admin.audit.read"],
  USER: [],
};

export async function seedRolesAndPermissions(db: PrismaClient): Promise<void> {
  for (const p of PERMISSIONS) {
    await db.permission.upsert({
      where: { key: p.key },
      create: p,
      update: { description: p.description, scope: p.scope },
    });
  }
  for (const [key, perms] of Object.entries(ROLES)) {
    const role = await db.role.upsert({
      where: { key },
      create: { key, name: key.replace("_", " "), isSystem: true },
      update: {},
    });
    for (const permKey of perms) {
      const perm = await db.permission.findUniqueOrThrow({ where: { key: permKey } });
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        create: { roleId: role.id, permissionId: perm.id },
        update: {},
      });
    }
  }
}

if (process.argv[1]?.includes("seed")) {
  const db = new PrismaClient();
  seedRolesAndPermissions(db)
    .then(() => db.$disconnect())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
