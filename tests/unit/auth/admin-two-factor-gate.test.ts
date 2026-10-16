import { describe, it, expect, vi, beforeEach } from "vitest";

const requestHeaders = new Headers();
const state = vi.hoisted(() => ({
  settingOn: true,
  credentialsEnabled: true as boolean | null,
  twoFactorEnabled: false,
  hasPassword: true,
  permissions: ["admin.settings.write", "admin.audit.read"],
}));

vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  forbidden: () => {
    throw new Error("FORBIDDEN");
  },
}));
vi.mock("@/server/auth", () => ({
  getAuth: async () => ({
    api: { getSession: async () => ({ user: { id: "admin_1", banned: false }, session: {} }) },
  }),
}));
vi.mock("@/server/services/users/password", () => ({
  hasPasswordCredential: async () => state.hasPassword,
}));
vi.mock("@/server/db", () => ({
  db: {
    userRole: {
      findFirst: async () =>
        state.permissions.some((key) => key.startsWith("admin.")) ? { roleId: "admin" } : null,
    },
    user: {
      findUnique: async () => ({
        banned: false,
        twoFactorEnabled: state.twoFactorEnabled,
        roles: [
          {
            role: {
              permissions: state.permissions.map((key) => ({ permission: { key } })),
            },
          },
        ],
      }),
    },
  },
}));
vi.mock("@/server/services/settings/app-settings", () => ({
  appSettings: {
    get: async (key: string) =>
      key === "credentials_enabled" ? state.credentialsEnabled : state.settingOn,
  },
}));

const { hasEnforcedPermission, isAdminTwoFactorBlocked, requirePermission } =
  await import("@/server/auth/permissions");

describe("admin 2FA enforcement (#243 SEC-01)", () => {
  beforeEach(() => {
    state.settingOn = true;
    state.twoFactorEnabled = false;
    state.hasPassword = true;
    state.credentialsEnabled = true;
    state.permissions = ["admin.settings.write", "admin.audit.read"];
    requestHeaders.set("x-bilan-path", "/en/admin/audit");
  });

  it("sends an admin without 2FA to the security settings from any admin page", async () => {
    await expect(requirePermission("admin.audit.read")).rejects.toThrow(
      "REDIRECT /en/settings/security",
    );
  });

  it("falls back to the default locale without a request path", async () => {
    requestHeaders.delete("x-bilan-path");
    await expect(requirePermission("admin.settings.write")).rejects.toThrow(
      "REDIRECT /fr/settings/security",
    );
  });

  it("refuses the admin permission to Server Actions until 2FA is enabled", async () => {
    expect(await hasEnforcedPermission("admin_1", "admin.audit.read")).toBe(false);
    state.twoFactorEnabled = true;
    expect(await hasEnforcedPermission("admin_1", "admin.audit.read")).toBe(true);
    expect(await requirePermission("admin.audit.read")).toMatchObject({ id: "admin_1" });
  });

  it("doesn't gate anything while the setting is off", async () => {
    state.settingOn = false;
    expect(await hasEnforcedPermission("admin_1", "admin.audit.read")).toBe(true);
    expect(await requirePermission("admin.audit.read")).toMatchObject({ id: "admin_1" });
  });

  it("still answers 403 for a permission the user doesn't hold", async () => {
    await expect(requirePermission("admin.users.delete")).rejects.toThrow("FORBIDDEN");
    expect(await hasEnforcedPermission("admin_1", "admin.users.delete")).toBe(false);
  });

  it("exempts an admin without a password, e.g. SSO only (#256)", async () => {
    state.hasPassword = false;
    expect(await hasEnforcedPermission("admin_1", "admin.audit.read")).toBe(true);
    expect(await requirePermission("admin.audit.read")).toMatchObject({ id: "admin_1" });
    expect(await isAdminTwoFactorBlocked("admin_1")).toBe(false);
  });

  it("tells the Security page when the gate suspends the user's admin rights (#256)", async () => {
    expect(await isAdminTwoFactorBlocked("admin_1")).toBe(true);
    state.twoFactorEnabled = true;
    expect(await isAdminTwoFactorBlocked("admin_1")).toBe(false);
  });

  it("shows no banner to a user without admin permissions (#256)", async () => {
    state.permissions = ["transactions.read"];
    expect(await isAdminTwoFactorBlocked("admin_1")).toBe(false);
  });

  it("exempts every admin while password sign-in is disabled instance-wide (#256)", async () => {
    state.credentialsEnabled = false;
    expect(await hasEnforcedPermission("admin_1", "admin.audit.read")).toBe(true);
    expect(await isAdminTwoFactorBlocked("admin_1")).toBe(false);
    state.credentialsEnabled = null;
    expect(await isAdminTwoFactorBlocked("admin_1")).toBe(true);
  });
});
