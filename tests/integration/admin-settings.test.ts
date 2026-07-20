import { describe, it, expect, afterAll } from "vitest";
import { db } from "@/server/db";
import { appSettings } from "@/server/services/settings/app-settings";
import { grantRole } from "@/server/services/users/roles";

const actorId = "appset_actor";
const grantTargetId = "grant_target";
const roleKey = "test_grant_role";

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { entity: "AppSetting", entityId: "registration_mode" } });
  await db.appSetting.deleteMany({ where: { key: "registration_mode" } });
  await db.auditLog.deleteMany({ where: { action: "user.role.granted", entityId: grantTargetId } });
  await db.userRole.deleteMany({ where: { userId: grantTargetId } });
  await db.user.deleteMany({ where: { id: grantTargetId } });
  await db.role.deleteMany({ where: { key: roleKey } });
  await db.$disconnect();
});

describe("appSettings.set audits + hot-reloads", () => {
  it("writes a settings.registration_mode.update audit entry and reflects the new value", async () => {
    await appSettings.set("registration_mode", "OPEN", actorId);

    expect(await appSettings.get("registration_mode")).toBe("OPEN");

    const audit = await db.auditLog.findFirst({
      where: { action: "settings.registration_mode.update", entityId: "registration_mode" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.userId).toBe(actorId);
  });
});

describe("grantRole audits", () => {
  it("writes a user.role.granted audit entry on a new grant", async () => {
    await db.userRole.deleteMany({ where: { userId: grantTargetId } });
    await db.user.deleteMany({ where: { id: grantTargetId } });
    await db.user.create({ data: { id: grantTargetId, email: "grant@bilan.local" } });
    // Self-contained: the CI test DB is migrated but not seeded, so create the
    // role rather than assuming one exists.
    await db.role.upsert({
      where: { key: roleKey },
      create: { key: roleKey, name: "Test Grant Role" },
      update: {},
    });

    await grantRole(db, grantTargetId, roleKey, actorId);

    const audit = await db.auditLog.findFirst({
      where: { action: "user.role.granted", entityId: grantTargetId },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.userId).toBe(actorId);
  });
});
