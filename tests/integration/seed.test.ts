import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { seedRolesAndPermissions, seedAppSettings } from "@/../prisma/seed";

beforeAll(async () => {
  await db.userRole.deleteMany();
  await db.rolePermission.deleteMany();
  await db.permission.deleteMany();
  await db.role.deleteMany();
  await db.appSetting.deleteMany();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("seedRolesAndPermissions", () => {
  it("creates SUPER_ADMIN, ADMIN, USER roles", async () => {
    await seedRolesAndPermissions(db);
    const roles = await db.role.findMany();
    expect(roles.map((r) => r.key).sort()).toEqual(["ADMIN", "SUPER_ADMIN", "USER"]);
  });

  it("is idempotent", async () => {
    await seedRolesAndPermissions(db);
    expect(await db.role.count()).toBe(3);
  });

  it("seeds default AppSetting rows", async () => {
    await seedAppSettings(db);
    const settings = await db.appSetting.findMany();
    expect(settings.map((s) => s.key).sort()).toEqual([
      "app_name",
      "credentials_enabled",
      "min_password_length",
      "registration_mode",
    ]);
  });
});
