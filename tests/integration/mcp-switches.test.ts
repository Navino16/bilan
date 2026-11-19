import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/server/db";
import { appSettings } from "@/server/services/settings/app-settings";
import { getMcpEnabled, setMcpEnabled } from "@/server/services/users/preferences";
import { isMcpInstanceEnabled } from "@/server/mcp/switches";
import { snapshotSetting } from "./support/app-setting-snapshot";

const perms = vi.hoisted(() => ({ security: true }));
vi.mock("@/server/auth/permissions", () => ({
  requirePermission: async () => ({ id: "mcpsw_admin", email: "mcpsw_admin@bilan.local" }),
  hasPermission: async () => perms.security,
}));

const { setAppSettingsAction } = await import("@/server/transport/actions/settings");

const userId = "mcpsw_user";
const adminId = "mcpsw_admin";
let restore: () => Promise<void>;

async function cleanup() {
  await db.auditLog.deleteMany({ where: { entity: "UserPreference", entityId: userId } });
  await db.userPreference.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: { in: [userId, adminId] } } });
}

beforeAll(async () => {
  await cleanup();
  for (const id of [userId, adminId]) {
    await db.user.create({ data: { id, email: `${id}@bilan.local` } });
  }
  restore = await snapshotSetting("mcp_enabled");
  await db.appSetting.deleteMany({ where: { key: "mcp_enabled" } });
  appSettings.forget("mcp_enabled");
});

afterAll(async () => {
  await restore();
  await db.auditLog.deleteMany({ where: { entity: "AppSetting", entityId: "mcp_enabled" } });
  await cleanup();
  await db.$disconnect();
});

describe("user MCP switch", () => {
  it("is off without a preference row and after a row created with defaults", async () => {
    expect(await getMcpEnabled(userId)).toBe(false);
    await db.userPreference.create({ data: { userId, locale: "en" } });
    expect(await getMcpEnabled(userId)).toBe(false);
  });

  it("turns on and off with an audit entry, keeping the stored locale", async () => {
    await setMcpEnabled(userId, true, "fr");
    expect(await getMcpEnabled(userId)).toBe(true);
    expect(await db.auditLog.count({ where: { action: "mcp.enabled", entityId: userId } })).toBe(1);
    await setMcpEnabled(userId, false, "fr");
    expect(await getMcpEnabled(userId)).toBe(false);
    expect(await db.auditLog.count({ where: { action: "mcp.disabled", entityId: userId } })).toBe(
      1,
    );
    const pref = await db.userPreference.findUnique({ where: { userId } });
    expect(pref?.locale).toBe("en");
  });
});

describe("instance MCP switch", () => {
  it("is off without a setting row and on once an admin enables it", async () => {
    expect(await isMcpInstanceEnabled()).toBe(false);
    await appSettings.set("mcp_enabled", true, adminId);
    expect(await isMcpInstanceEnabled()).toBe(true);
  });

  it("is saved by the admin action as a strict boolean", async () => {
    const ok = new FormData();
    ok.set("s:mcp_enabled", "true");
    expect(await setAppSettingsAction(null, ok)).toEqual({ ok: true });
    expect(await appSettings.get("mcp_enabled")).toBe(true);

    const bad = new FormData();
    bad.set("s:mcp_enabled", "maybe");
    expect(await setAppSettingsAction(null, bad)).toMatchObject({
      ok: false,
      error: "INVALID",
      fieldErrors: { "s:mcp_enabled": "INVALID" },
    });
  });

  it("is refused to an admin without admin.security.write", async () => {
    await appSettings.set("mcp_enabled", false, adminId);
    perms.security = false;
    try {
      const fd = new FormData();
      fd.set("s:mcp_enabled", "true");
      expect(await setAppSettingsAction(null, fd)).toEqual({ ok: false, error: "FORBIDDEN" });
      expect(await appSettings.get("mcp_enabled")).toBe(false);
    } finally {
      perms.security = true;
    }
  });
});
