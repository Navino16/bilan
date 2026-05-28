import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { seedRolesAndPermissions } from "@/../prisma/seed";

beforeAll(async () => {
  await db.userRole.deleteMany();
  await db.rolePermission.deleteMany();
  await db.permission.deleteMany();
  await db.role.deleteMany();
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
});
