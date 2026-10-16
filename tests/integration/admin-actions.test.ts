import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/server/db";
import { seedRolesAndPermissions } from "@/../prisma/seed";
import { grantRole } from "@/server/services/users/roles";
import { buildPermissionsChecker } from "@/server/auth/permissions";
import { appSettings } from "@/server/services/settings/app-settings";

const current = vi.hoisted(() => ({ user: null as { id: string; email: string } | null }));
vi.mock("@/server/auth/permissions", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/auth/permissions")>();
  const { db } = await import("@/server/db");
  const check = real.buildPermissionsChecker(db);
  return {
    ...real,
    getCurrentUser: async () => current.user,
    hasPermission: check,
    requirePermission: async (key: string) => {
      if (!current.user || !(await check(current.user.id, key))) throw new Error("FORBIDDEN");
      return current.user;
    },
  };
});
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: async () => {} }) },
}));

const {
  adminCreateUserAction,
  createSignupTokenAction,
  deleteSignupTokenAction,
  setUserDisabledAction,
  adminDeleteUserAction,
  adminMarkEmailVerifiedAction,
} = await import("@/server/transport/actions/admin");
const {
  sendSmtpTestAction,
  deleteSmtpConfigAction,
  upsertSmtpAction,
  setAppSettingsAction,
  saveAuthProviderAction,
  deleteAuthProviderAction,
} = await import("@/server/transport/actions/settings");
const { testOidcConnectionAction } = await import("@/server/transport/actions/setup");

const stamp = Date.now();
const users = {
  super: { id: `act_super_${stamp}`, email: `act-super+${stamp}@bilan.local` },
  admin: { id: `act_admin_${stamp}`, email: `act-admin+${stamp}@bilan.local` },
  user: { id: `act_user_${stamp}`, email: `act-user+${stamp}@bilan.local` },
};
const all = Object.values(users).map((u) => u.id);
const form = (data: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.set(k, v);
  return fd;
};

beforeAll(async () => {
  await seedRolesAndPermissions(db);
  await db.user.createMany({ data: Object.values(users) });
  await grantRole(db, users.super.id, "SUPER_ADMIN");
  await grantRole(db, users.admin.id, "ADMIN");
  await db.smtpConfig.deleteMany();
  expect(await buildPermissionsChecker(db)(users.admin.id, "admin.users.disable")).toBe(true);
});

afterAll(async () => {
  await db.adminSignupToken.deleteMany({ where: { createdById: { in: all } } });
  await db.smtpConfig.deleteMany();
  await db.auditLog.deleteMany({
    where: { OR: [{ userId: { in: all } }, { entityId: { in: all } }] },
  });
  await db.user.deleteMany({ where: { id: { in: all } } });
  await db.$disconnect();
});

describe("signup token actions", () => {
  it("creates a token expiring after the chosen number of days", async () => {
    current.user = users.super;
    const before = Date.now();
    expect(
      await createSignupTokenAction(
        null,
        form({ description: `act ${stamp}`, maxUses: "", expiresInDays: "7" }),
      ),
    ).toEqual({ ok: true });
    const row = await db.adminSignupToken.findFirst({ where: { description: `act ${stamp}` } });
    const delta = row!.expiresAt!.getTime() - before;
    expect(delta).toBeGreaterThanOrEqual(7 * 86_400_000);
    expect(delta).toBeLessThan(7 * 86_400_000 + 60_000);
  });

  it("refuses token management to an admin without the permission", async () => {
    current.user = users.admin;
    expect(await deleteSignupTokenAction(null, form({ id: "x" }))).toEqual({
      ok: false,
      error: "UNAUTHORIZED",
    });
    expect(
      await createSignupTokenAction(
        null,
        form({ description: "", maxUses: "", expiresInDays: "" }),
      ),
    ).toEqual({ ok: false, error: "UNAUTHORIZED" });
  });
});

describe("adminMarkEmailVerifiedAction (#240)", () => {
  it("needs admin.users.update, then marks the address verified once, audited", async () => {
    const verified = async () =>
      (await db.user.findUniqueOrThrow({ where: { id: users.user.id } })).emailVerified;
    current.user = users.admin;
    expect(await adminMarkEmailVerifiedAction(null, form({ userId: users.user.id }))).toEqual({
      ok: false,
      error: "UNAUTHORIZED",
    });
    expect(await verified()).toBe(false);

    current.user = users.super;
    expect(await adminMarkEmailVerifiedAction(null, form({ userId: "" }))).toEqual({
      ok: false,
      error: "INVALID",
    });
    expect(await adminMarkEmailVerifiedAction(null, form({ userId: users.super.id }))).toEqual({
      ok: false,
      error: "SELF",
    });
    for (let i = 0; i < 2; i++) {
      expect(await adminMarkEmailVerifiedAction(null, form({ userId: users.user.id }))).toEqual({
        ok: true,
      });
    }
    expect(await verified()).toBe(true);
    const audits = await db.auditLog.findMany({
      where: { action: "user.email_verified", entityId: users.user.id },
    });
    expect(audits.map((a) => a.userId)).toEqual([users.super.id]);
  });
});

describe("adminCreateUserAction", () => {
  it("puts a duplicate e-mail on the e-mail field (#227)", async () => {
    current.user = users.super;
    expect(
      await adminCreateUserAction(
        null,
        form({ name: "Twin", email: users.user.email.toUpperCase(), role: "USER" }),
      ),
    ).toEqual({ ok: false, error: "USER_EXISTS", fieldErrors: { email: "USER_EXISTS" } });
  });

  it("says no setup link was mailed while SMTP isn't configured (#255)", async () => {
    current.user = users.super;
    const email = `act-nomail+${stamp}@bilan.local`;
    try {
      expect(
        await adminCreateUserAction(null, form({ name: "No Mail", email, role: "USER" })),
      ).toEqual({ ok: true, setupMailSent: false });
    } finally {
      await db.user.deleteMany({ where: { email } });
    }
  });
});

describe("user lifecycle actions", () => {
  it("refuses everything to a plain user", async () => {
    current.user = users.user;
    expect(
      await setUserDisabledAction(null, form({ userId: users.admin.id, disabled: "true" })),
    ).toEqual({ ok: false, error: "UNAUTHORIZED" });
    expect(
      await adminDeleteUserAction(null, form({ userId: users.admin.id, confirmEmail: "" })),
    ).toEqual({ ok: false, error: "UNAUTHORIZED" });
  });

  it("lets an admin disable a user, but not delete one", async () => {
    current.user = users.admin;
    expect(
      await setUserDisabledAction(null, form({ userId: users.user.id, disabled: "true" })),
    ).toEqual({ ok: true });
    expect(
      await setUserDisabledAction(null, form({ userId: users.user.id, disabled: "false" })),
    ).toEqual({ ok: true });
    expect(
      await adminDeleteUserAction(
        null,
        form({ userId: users.user.id, confirmEmail: users.user.email }),
      ),
    ).toEqual({ ok: false, error: "UNAUTHORIZED" });
  });

  it("maps service refusals to error codes", async () => {
    current.user = users.admin;
    expect(
      await setUserDisabledAction(null, form({ userId: users.super.id, disabled: "true" })),
    ).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(
      await setUserDisabledAction(null, form({ userId: users.user.id, disabled: "yes" })),
    ).toEqual({ ok: false, error: "INVALID" });
  });
});

describe("SMTP actions", () => {
  it("are refused without admin.security.write, even to an ADMIN (#223)", async () => {
    for (const user of [users.user, users.admin]) {
      current.user = user;
      await expect(sendSmtpTestAction(null, form({ locale: "fr" }))).rejects.toThrow("FORBIDDEN");
      await expect(deleteSmtpConfigAction()).rejects.toThrow("FORBIDDEN");
      await expect(
        upsertSmtpAction(null, form({ host: "smtp.evil.test", port: "25", fromAddress: "a@b.c" })),
      ).rejects.toThrow("FORBIDDEN");
    }
    expect(await db.smtpConfig.count({ where: { host: "smtp.evil.test" } })).toBe(0);
  });

  it("rate-limits the SMTP test per super admin", async () => {
    current.user = users.super;
    const results = [];
    for (let i = 0; i < 6; i++)
      results.push(await sendSmtpTestAction(null, form({ locale: "fr" })));
    expect(results.slice(0, 5).every((r) => r && !r.ok && r.error === "NOT_CONFIGURED")).toBe(true);
    expect(results[5]).toEqual({ ok: false, error: "RATE_LIMITED" });
  });
});

describe("admin 2FA enforcement (#243)", () => {
  it("refuses admin Server Actions to an admin without 2FA once the instance requires it", async () => {
    const saved = await db.appSetting.findUnique({ where: { key: "security.admin_2fa_required" } });
    await appSettings.set("security.admin_2fa_required", true, users.super.id);
    try {
      current.user = users.admin;
      expect(
        await setUserDisabledAction(null, form({ userId: users.user.id, disabled: "false" })),
      ).toEqual({ ok: false, error: "UNAUTHORIZED" });
      current.user = users.super;
      expect(await testOidcConnectionAction("")).toEqual({ ok: false, error: "UNAUTHORIZED" });

      await db.user.update({ where: { id: users.super.id }, data: { twoFactorEnabled: true } });
      expect(await testOidcConnectionAction("")).toEqual({ ok: false, error: "NO_ISSUER" });
    } finally {
      await db.user.update({ where: { id: users.super.id }, data: { twoFactorEnabled: false } });
      await appSettings.set("security.admin_2fa_required", saved?.value ?? false, users.super.id);
    }
  });
});

describe("security settings (#223)", () => {
  const admin2fa = async () =>
    String(
      (await db.appSetting.findUnique({ where: { key: "security.admin_2fa_required" } }))?.value ??
        false,
    );

  it("are refused to an ADMIN, who keeps the general settings", async () => {
    current.user = users.admin;
    expect(
      await setAppSettingsAction(null, form({ "s:security.admin_2fa_required": await admin2fa() })),
    ).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await setAppSettingsAction(null, form({ "s:registration_mode": "OPEN" }))).toEqual({
      ok: false,
      error: "FORBIDDEN",
    });
    await expect(
      saveAuthProviderAction(null, form({ mode: "create", key: "x", type: "oidc" })),
    ).rejects.toThrow("FORBIDDEN");
    await expect(deleteAuthProviderAction("x")).rejects.toThrow("FORBIDDEN");
    expect(await testOidcConnectionAction("")).toEqual({ ok: false, error: "UNAUTHORIZED" });

    const appName = async () =>
      (await db.appSetting.findUnique({ where: { key: "app_name" } }))?.value;
    const name = await appName();
    expect(
      await setAppSettingsAction(
        null,
        form({ "s:app_name": `Mixed ${stamp}`, "s:registration_mode": "OPEN" }),
      ),
    ).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await appName()).toEqual(name);
    expect(
      await setAppSettingsAction(null, form({ "s:app_name": String(name ?? "Bilan") })),
    ).toEqual({ ok: true });
  });

  it("are allowed to a SUPER_ADMIN", async () => {
    current.user = users.super;
    expect(
      await setAppSettingsAction(null, form({ "s:security.admin_2fa_required": await admin2fa() })),
    ).toEqual({ ok: true });
    expect(await testOidcConnectionAction("")).toEqual({ ok: false, error: "NO_ISSUER" });
    expect(await deleteAuthProviderAction("missing-provider-223")).toMatchObject({
      ok: false,
      error: "NOT_FOUND",
    });
  });

  it("refuses to disable password sign-in while it would lock a user out (#255)", async () => {
    current.user = users.super;
    const prior = await db.appSetting.findUnique({ where: { key: "credentials_enabled" } });
    await appSettings.set("credentials_enabled", true, users.super.id);
    const accountId = `act_pw_${stamp}`;
    await db.authAccount.create({
      data: {
        id: accountId,
        userId: users.user.id,
        accountId: users.user.id,
        providerId: "credential",
        password: "hashed",
      },
    });
    try {
      const res = await setAppSettingsAction(null, form({ "s:credentials_enabled": "false" }));
      expect(res).toMatchObject({ ok: false, error: "LOCKOUT" });
      expect(res && !res.ok && res.count).toBeGreaterThanOrEqual(1);
      expect(await appSettings.get("credentials_enabled")).toBe(true);
    } finally {
      await db.authAccount.delete({ where: { id: accountId } });
      await appSettings.set("credentials_enabled", prior?.value ?? true, users.super.id);
      if (!prior) await db.appSetting.delete({ where: { key: "credentials_enabled" } });
    }
  });
});
