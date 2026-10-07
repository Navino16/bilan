import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { seedRolesAndPermissions } from "@/../prisma/seed";
import { adminCreateUser } from "@/server/services/users/create";

const actorId = "admin_create_actor";
const newEmail = `created+${Date.now()}@bilan.local`;

beforeAll(async () => {
  await seedRolesAndPermissions(db);
  await db.session.deleteMany();
  await db.authAccount.deleteMany();
  await db.userRole.deleteMany({ where: { userId: actorId } });
  await db.user.deleteMany({ where: { email: newEmail } });
  await db.user.deleteMany({ where: { id: actorId } });
  await db.user.create({ data: { id: actorId, email: `admin-create-actor@bilan.local` } });
});

afterAll(async () => {
  await db.user.deleteMany({ where: { email: newEmail } });
  await db.user.deleteMany({ where: { id: actorId } });
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
    ).rejects.toThrow();
    await db.user.delete({ where: { id } });
  });
});
