import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { completeSetup, isSetupNeeded } from "@/server/services/bootstrap";
import { seedRolesAndPermissions } from "@/../prisma/seed";

beforeAll(async () => {
  await db.userRole.deleteMany();
  await db.userPreference.deleteMany();
  await db.session.deleteMany();
  await db.authAccount.deleteMany();
  await db.user.deleteMany();
  // completeSetup grants SUPER_ADMIN, so the role must exist regardless of
  // which integration file ran (and reset roles) before this one.
  await seedRolesAndPermissions(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("setup wizard", () => {
  it("creates the first user and grants SUPER_ADMIN", async () => {
    expect(await isSetupNeeded()).toBe(true);
    const { userId } = await completeSetup({
      email: "first@bilan.local",
      password: "first-strong-password-12345",
      name: "First",
      locale: "fr",
    });
    const roles = await db.userRole.findMany({ where: { userId }, include: { role: true } });
    expect(roles.map((r) => r.role.key)).toEqual(["SUPER_ADMIN"]);
    expect(await isSetupNeeded()).toBe(false);
  });

  it("refuses to run twice", async () => {
    await expect(
      completeSetup({ email: "second@bilan.local", password: "p".repeat(12), name: "X" }),
    ).rejects.toThrow();
  });
});
