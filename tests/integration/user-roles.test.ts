import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { seedRolesAndPermissions } from "@/../prisma/seed";
import { grantRole, setUserRole } from "@/server/services/users/roles";

const superId = "roles_super";
const adminId = "roles_admin";
const targetId = "roles_target";
const ids = [superId, adminId, targetId];

async function roleKeys(userId: string): Promise<string[]> {
  const rows = await db.userRole.findMany({ where: { userId }, include: { role: true } });
  return rows.map((r) => r.role.key);
}

beforeAll(async () => {
  await seedRolesAndPermissions(db);
  await db.auditLog.deleteMany({ where: { entityId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  for (const id of ids) await db.user.create({ data: { id, email: `${id}@bilan.local` } });
  await grantRole(db, superId, "SUPER_ADMIN");
  await grantRole(db, adminId, "ADMIN");
  await grantRole(db, targetId, "USER");
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { entityId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

describe("setUserRole", () => {
  it("replaces the role and audits from/to", async () => {
    await setUserRole({ id: superId }, targetId, "ADMIN");

    expect(await roleKeys(targetId)).toEqual(["ADMIN"]);
    const audit = await db.auditLog.findFirst({
      where: { action: "user.role.changed", entityId: targetId },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.userId).toBe(superId);
    expect(audit?.metadata).toEqual({ from: "USER", to: "ADMIN" });
  });

  it("does not audit an unchanged role", async () => {
    await setUserRole({ id: superId }, targetId, "ADMIN");
    expect(
      await db.auditLog.count({ where: { action: "user.role.changed", entityId: targetId } }),
    ).toBe(1);
  });

  it("refuses to change the actor's own role", async () => {
    await expect(setUserRole({ id: superId }, superId, "USER")).rejects.toThrow("SELF");
    expect(await roleKeys(superId)).toEqual(["SUPER_ADMIN"]);
  });

  it("refuses an admin demoting another admin", async () => {
    await expect(setUserRole({ id: adminId }, targetId, "USER")).rejects.toThrow("FORBIDDEN");
    expect(await roleKeys(targetId)).toEqual(["ADMIN"]);
  });

  it("refuses an unknown user", async () => {
    await expect(setUserRole({ id: superId }, "roles_missing", "USER")).rejects.toThrow(
      "NOT_FOUND",
    );
  });
});
