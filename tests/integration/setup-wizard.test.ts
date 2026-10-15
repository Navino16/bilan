import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { completeSetup, isSetupNeeded } from "@/server/services/bootstrap";
import { appSettings } from "@/server/services/settings/app-settings";
import { completeSetupAction } from "@/server/transport/actions/setup";
import { seedRolesAndPermissions } from "@/../prisma/seed";

let firstUserId = "";

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
  // Vitest orders files by past duration: a leftover SUPER_ADMIN breaks user-lifecycle.
  if (firstUserId) await db.user.deleteMany({ where: { id: firstUserId } });
  await db.$disconnect();
});

describe("setup wizard", () => {
  it("creates the first user, grants SUPER_ADMIN and seeds categories in its locale", async () => {
    expect(await isSetupNeeded()).toBe(true);
    const { userId } = await completeSetup({
      email: "first@bilan.local",
      password: "first-strong-password-12345",
      name: "First",
      locale: "en",
    });
    firstUserId = userId;
    const roles = await db.userRole.findMany({ where: { userId }, include: { role: true } });
    expect(roles.map((r) => r.role.key)).toEqual(["SUPER_ADMIN"]);
    // Nobody else could verify the first super admin's address (#243).
    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).emailVerified).toBe(true);
    const verified = await db.auditLog.findFirst({
      where: { userId, action: "auth.email.verified" },
    });
    expect(verified?.metadata).toEqual({ via: "setup" });
    const roots = await db.category.findMany({ where: { userId, parentId: null } });
    expect(roots.map((c) => c.name)).toContain("Income");
    expect(await isSetupNeeded()).toBe(false);
  });

  it("refuses to run twice", async () => {
    await expect(
      completeSetup({ email: "second@bilan.local", password: "p".repeat(12), name: "X" }),
    ).rejects.toThrow();
  });

  it("rejects a password below the configured minimum (#169)", async () => {
    const saved = await db.appSetting.findUnique({ where: { key: "min_password_length" } });
    await appSettings.set("min_password_length", 20, firstUserId);
    try {
      const fd = new FormData();
      fd.set("name", "Short");
      fd.set("email", "short@bilan.local");
      fd.set("password", "p".repeat(19));
      fd.set("locale", "en");
      fd.set("mode", "OPEN");
      expect(await completeSetupAction(null, fd)).toEqual({
        ok: false,
        error: "PASSWORD_TOO_SHORT",
      });
    } finally {
      if (saved) await appSettings.set("min_password_length", saved.value, firstUserId);
      else await db.appSetting.deleteMany({ where: { key: "min_password_length" } });
    }
  });
});
