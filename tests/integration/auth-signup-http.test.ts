import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { AppSetting } from "@prisma/client";

const requestHeaders = vi.hoisted(() => ({ init: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(requestHeaders.init),
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

import { db } from "@/server/db";
import { env } from "@/env";
import { getAuth, invalidateAuthCache } from "@/server/auth";
import { appSettings } from "@/server/services/settings/app-settings";
import { createSignupToken } from "@/server/services/signup-tokens";
import { storeSignupLocale } from "@/server/services/users/preferences";
import { registerAction, resetConfirmAction } from "@/server/transport/actions/auth";

const actorId = "signup_http_actor";
const tag = "signup-http";
const password = "correct-horse-battery";
const appUrl = env.APP_URL.replace(/\/$/, "");
let savedMode: AppSetting | null = null;
let savedMinLength: AppSetting | null = null;

const email = (label: string) => `${tag}-${label}+${Date.now()}@bilan.local`;

async function cleanup() {
  const users = await db.user.findMany({
    where: { email: { contains: tag } },
    select: { id: true },
  });
  await db.auditLog.deleteMany({
    where: {
      OR: [
        { userId: { in: [actorId, ...users.map((u) => u.id)] } },
        { action: { startsWith: "auth." }, metadata: { path: "$.email", string_contains: tag } },
      ],
    },
  });
  const where = { user: { email: { contains: tag } } };
  await db.session.deleteMany({ where });
  await db.authAccount.deleteMany({ where });
  await db.user.deleteMany({ where: { email: { contains: tag } } });
  await db.adminSignupToken.deleteMany({ where: { createdById: actorId } });
}

beforeAll(async () => {
  savedMode = await db.appSetting.findUnique({ where: { key: "registration_mode" } });
  savedMinLength = await db.appSetting.findUnique({ where: { key: "min_password_length" } });
  await cleanup();
  await db.user.deleteMany({ where: { id: actorId } });
  await db.user.create({ data: { id: actorId, email: `${tag}-actor@bilan.local` } });
});

afterAll(async () => {
  if (savedMode) {
    await db.appSetting.update({
      where: { key: "registration_mode" },
      data: { value: savedMode.value as never, updatedById: savedMode.updatedById },
    });
  } else await db.appSetting.deleteMany({ where: { key: "registration_mode" } });
  if (savedMinLength) {
    await db.appSetting.update({
      where: { key: "min_password_length" },
      data: { value: savedMinLength.value as never, updatedById: savedMinLength.updatedById },
    });
  } else await db.appSetting.deleteMany({ where: { key: "min_password_length" } });
  invalidateAuthCache();
  await cleanup();
  await db.user.deleteMany({ where: { id: actorId } });
  await db.$disconnect();
});

async function post(path: string, body: Record<string, unknown>): Promise<Response> {
  const auth = await getAuth();
  return auth.handler(
    new Request(`${appUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: appUrl },
      body: JSON.stringify(body),
    }),
  );
}

function registerForm(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("HTTP sign-up endpoint (#197)", () => {
  it.each(["OPEN", "INVITE_ONLY", "DISABLED"])(
    "refuses POST /sign-up/email in %s mode without creating a user",
    async (mode) => {
      await appSettings.set("registration_mode", mode, actorId);
      const target = email(mode.toLowerCase());
      const res = await post("/api/auth/sign-up/email", { email: target, password, name: "M" });
      expect(res.status).toBe(404);
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(await db.user.findUnique({ where: { email: target } })).toBeNull();
    },
  );

  it.each(["/api/auth/sign-up/email?x=1", "/api/auth/./sign-up/email"])(
    "refuses the path variant %s",
    async (path) => {
      await appSettings.set("registration_mode", "OPEN", actorId);
      const target = email("variant");
      const res = await post(path, { email: target, password, name: "M" });
      expect(res.status).toBe(404);
      expect(await db.user.findUnique({ where: { email: target } })).toBeNull();
    },
  );

  it.each(["/verify-password", "/change-password", "/request-password-reset", "/reset-password"])(
    "blocks %s, which Server Actions wrap with limits and audit",
    async (path) => {
      const res = await post(`/api/auth${path}`, { email: email("pw"), password });
      expect(res.status).toBe(404);
    },
  );

  it.each([
    "/two-factor/enable",
    "/two-factor/disable",
    "/update-user",
    "/update-session",
    "/unlink-account",
    "/two-factor/get-totp-uri",
    "/two-factor/generate-backup-codes",
    "/two-factor/send-otp",
    "/two-factor/verify-otp",
    "/link-social",
    ...[
      "ban-user",
      "create-user",
      "get-user",
      "has-permission",
      "impersonate-user",
      "list-user-sessions",
      "list-users",
      "remove-user",
      "revoke-user-session",
      "revoke-user-sessions",
      "set-role",
      "set-user-password",
      "stop-impersonating",
      "unban-user",
      "update-user",
    ].map((p) => `/admin/${p}`),
  ])("blocks %s, unused or wrapped by Server Actions (#200)", async (path) => {
    const res = await post(`/api/auth${path}`, { password, name: "X", userId: actorId });
    expect(res.status).toBe(404);
  });

  it("keeps the other HTTP endpoints reachable", async () => {
    const res = await post("/api/auth/sign-in/email", { email: email("signin"), password });
    expect(res.status).toBe(401);
  });

  it("still allows server-side auth.api.signUpEmail (setup bootstrap)", async () => {
    const target = email("api");
    const auth = await getAuth();
    const res = await auth.api.signUpEmail({ body: { email: target, password, name: "Api" } });
    expect(res.user.email).toBe(target);
  });

  it("still allows registerAction with a valid invite in INVITE_ONLY mode", async () => {
    await appSettings.set("registration_mode", "INVITE_ONLY", actorId);
    const { token } = await createSignupToken({ maxUses: 1, createdById: actorId });
    const target = email("invite");
    const res = await registerAction(
      null,
      registerForm({
        email: target,
        password,
        confirmPassword: password,
        name: "Inv",
        adminToken: token,
      }),
    );
    expect(res).toEqual({ ok: true });
    expect(await db.user.findUnique({ where: { email: target } })).not.toBeNull();
  });

  it("registerAction still enforces the mode", async () => {
    await appSettings.set("registration_mode", "INVITE_ONLY", actorId);
    const noToken = email("no-token");
    expect(
      await registerAction(
        null,
        registerForm({ email: noToken, password, confirmPassword: password, name: "N" }),
      ),
    ).toEqual({ ok: false, error: "TOKEN_REQUIRED" });

    await appSettings.set("registration_mode", "DISABLED", actorId);
    const disabled = email("disabled");
    expect(
      await registerAction(
        null,
        registerForm({ email: disabled, password, confirmPassword: password, name: "D" }),
      ),
    ).toEqual({ ok: false, error: "DISABLED" });
    expect(await db.user.count({ where: { email: { in: [noToken, disabled] } } })).toBe(0);
  });

  it("seeds the default categories in the signup page's locale (#169)", async () => {
    const auth = await getAuth();
    const roots = async (userId: string) =>
      (await db.category.findMany({ where: { userId, parentId: null } })).map((c) => c.name);

    const en = await auth.api.signUpEmail({
      body: { email: email("locale-en"), password, name: "En" },
      headers: new Headers({ referer: `${appUrl}/en/register` }),
    });
    expect(await roots(en.user.id)).toContain("Income");

    const fallback = await auth.api.signUpEmail({
      body: { email: email("locale-default"), password, name: "Fr" },
    });
    expect(await roots(fallback.user.id)).toContain("Revenus");
  });

  it("stores the signup page's locale as the user's preference (#214)", async () => {
    const auth = await getAuth();
    const prefLocale = async (userId: string) =>
      (await db.userPreference.findUnique({ where: { userId } }))?.locale;

    const en = await auth.api.signUpEmail({
      body: { email: email("pref-en"), password, name: "En" },
      headers: new Headers({ referer: `${appUrl}/en/register` }),
    });
    expect(await prefLocale(en.user.id)).toBe("en");

    const fr = await auth.api.signUpEmail({
      body: { email: email("pref-fr"), password, name: "Fr" },
      headers: new Headers({ referer: `${appUrl}/fr/register`, "accept-language": "en" }),
    });
    expect(await prefLocale(fr.user.id)).toBe("fr");

    await appSettings.set("registration_mode", "OPEN", actorId);
    await appSettings.set("min_password_length", 8, actorId);
    const viaAction = email("pref-action");
    requestHeaders.init = { referer: `${appUrl}/en/register` };
    try {
      expect(
        await registerAction(
          null,
          registerForm({ email: viaAction, password, confirmPassword: password, name: "A" }),
        ),
      ).toEqual({ ok: true });
    } finally {
      requestHeaders.init = {};
    }
    const user = await db.user.findUniqueOrThrow({ where: { email: viaAction } });
    expect(await prefLocale(user.id)).toBe("en");
  });

  it("falls back to the NEXT_LOCALE cookie without a same-origin Referer, as on SSO callbacks (#214)", async () => {
    const auth = await getAuth();
    const res = await auth.api.signUpEmail({
      body: { email: email("pref-cookie"), password, name: "Sso" },
      headers: new Headers({
        referer: "https://idp.example/en/authorize",
        cookie: "a=1; NEXT_LOCALE=en",
        "accept-language": "fr-FR,fr;q=0.9",
      }),
    });
    expect((await db.userPreference.findUnique({ where: { userId: res.user.id } }))?.locale).toBe(
      "en",
    );
  });

  it("never overwrites an existing locale preference (#214)", async () => {
    const auth = await getAuth();
    const res = await auth.api.signUpEmail({
      body: { email: email("pref-keep"), password, name: "Keep" },
      headers: new Headers({ referer: `${appUrl}/en/register` }),
    });
    await storeSignupLocale(res.user.id, "fr");
    expect((await db.userPreference.findUnique({ where: { userId: res.user.id } }))?.locale).toBe(
      "en",
    );
  });

  it("registerAction enforces the configured minimum password length (#169)", async () => {
    await appSettings.set("registration_mode", "OPEN", actorId);
    await appSettings.set("min_password_length", password.length + 1, actorId);
    const target = email("short");
    expect(
      await registerAction(
        null,
        registerForm({ email: target, password, confirmPassword: password, name: "S" }),
      ),
    ).toEqual({ ok: false, error: "INVALID", fieldErrors: { password: "PASSWORD_TOO_SHORT" } });
    expect(await db.user.findUnique({ where: { email: target } })).toBeNull();
  });

  it("resetConfirmAction enforces the configured minimum password length (#169)", async () => {
    await appSettings.set("min_password_length", password.length + 1, actorId);
    expect(await resetConfirmAction(null, registerForm({ token: "any-token", password }))).toEqual({
      ok: false,
      error: "INVALID",
      fieldErrors: { password: "PASSWORD_TOO_SHORT" },
    });
  });
});
