import { describe, it, expect, afterAll } from "vitest";
import { db } from "@/server/db";
import { appSettings } from "@/server/services/settings/app-settings";

const actorId = "appset_actor";

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { entity: "AppSetting", entityId: "registration_mode" } });
  await db.appSetting.deleteMany({ where: { key: "registration_mode" } });
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
