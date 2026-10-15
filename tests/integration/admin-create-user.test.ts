import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { seedRolesAndPermissions } from "@/../prisma/seed";
import { adminCreateUser, UserExistsError } from "@/server/services/users/create";
import { grantRole } from "@/server/services/users/roles";

const actorId = "admin_create_actor";
const plainAdminId = "admin_create_plain_admin";
const newEmail = `created+${Date.now()}@bilan.local`;

beforeAll(async () => {
  await seedRolesAndPermissions(db);
  await db.session.deleteMany();
  await db.authAccount.deleteMany();
  await db.userRole.deleteMany({ where: { userId: { in: [actorId, plainAdminId] } } });
  await db.user.deleteMany({ where: { email: newEmail } });
  await db.user.deleteMany({ where: { id: { in: [actorId, plainAdminId] } } });
  await db.user.create({ data: { id: actorId, email: `admin-create-actor@bilan.local` } });
  await db.user.create({ data: { id: plainAdminId, email: `admin-create-plain@bilan.local` } });
  await grantRole(db, actorId, "SUPER_ADMIN");
  await grantRole(db, plainAdminId, "ADMIN");
});

afterAll(async () => {
  await db.user.deleteMany({ where: { email: newEmail } });
  await db.user.deleteMany({ where: { id: { in: [actorId, plainAdminId] } } });
  await db.$disconnect();
});

describe("adminCreateUser", () => {
  it("creates a user with the requested role and an audit entry", async () => {
    const { id } = await adminCreateUser(
      { email: newEmail, name: "Created User", role: "ADMIN" },
      { id: actorId },
    );

    const user = await db.user.findUnique({ where: { id } });
    expect(user?.email).toBe(newEmail);

    const roles = await db.userRole.findMany({ where: { userId: id }, include: { role: true } });
    expect(roles.map((r) => r.role.key)).toEqual(["ADMIN"]);

    const audit = await db.auditLog.findFirst({
      where: { action: "user.created_by_admin", entityId: id },
    });
    expect(audit).not.toBeNull();
  });

  it("refuses an ADMIN granting ADMIN, before creating anything (#223)", async () => {
    const email = `escalate+${Date.now()}@bilan.local`;
    await expect(
      adminCreateUser({ email, name: "Escalated", role: "ADMIN" }, { id: plainAdminId }),
    ).rejects.toThrow("FORBIDDEN");
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
  });

  it("refuses a disabled super admin granting ADMIN (#223)", async () => {
    const email = `banned-escalate+${Date.now()}@bilan.local`;
    await db.user.update({ where: { id: actorId }, data: { banned: true } });
    try {
      await expect(
        adminCreateUser({ email, name: "Escalated", role: "ADMIN" }, { id: actorId }),
      ).rejects.toThrow("FORBIDDEN");
    } finally {
      await db.user.update({ where: { id: actorId }, data: { banned: false } });
    }
  });

  it("lets an ADMIN create a plain USER (#223)", async () => {
    const email = `by-admin+${Date.now()}@bilan.local`;
    const { id } = await adminCreateUser(
      { email, name: "By Admin", role: "USER" },
      { id: plainAdminId },
    );
    const roles = await db.userRole.findMany({ where: { userId: id }, include: { role: true } });
    expect(roles.map((r) => r.role.key)).toEqual(["USER"]);
    await db.user.delete({ where: { id } });
  });

  it("seeds the default categories and stores the locale picked by the admin (#169, #214)", async () => {
    const email = `locale+${Date.now()}@bilan.local`;
    const { id } = await adminCreateUser(
      { email, name: "English User", role: "USER", locale: "en" },
      { id: actorId },
    );
    const roots = await db.category.findMany({ where: { userId: id, parentId: null } });
    expect(roots.map((c) => c.name)).toContain("Income");
    expect((await db.userPreference.findUnique({ where: { userId: id } }))?.locale).toBe("en");
    await db.user.delete({ where: { id } });
  });

  it("rejects a blank name before creating anything (#163)", async () => {
    const email = `blank+${Date.now()}@bilan.local`;
    await expect(
      adminCreateUser({ email, name: "   ", role: "USER" }, { id: actorId }),
    ).rejects.toThrow();
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
  });

  it("opens no session for the new user, so the admin stays signed in as themselves", async () => {
    const email = `nosession+${Date.now()}@bilan.local`;
    const { id } = await adminCreateUser(
      { email, name: "No Session", role: "USER" },
      { id: actorId },
    );
    expect(await db.session.count({ where: { userId: id } })).toBe(0);
    const account = await db.authAccount.findFirst({ where: { userId: id } });
    expect(account?.providerId).toBe("credential");
    expect(account?.password).toBeTruthy();
    await expect(
      adminCreateUser({ email, name: "Twice", role: "USER" }, { id: actorId }),
    ).rejects.toBeInstanceOf(UserExistsError);
    await db.user.delete({ where: { id } });
  });
});
