"use server";

import { getTranslations } from "next-intl/server";
import { hasLocale } from "next-intl";
import { requirePermission } from "@/server/auth/permissions";
import { smtpTestLimiter } from "@/server/auth/rate-limit";
import { appSettings, getAppName } from "@/server/services/settings/app-settings";
import {
  deleteSmtpConfig,
  sendSmtpTest,
  SmtpPasswordRequiredError,
  upsertSmtp,
  smtpSchema,
  type SmtpFailure,
} from "@/server/services/settings/smtp";
import { defaultLocale, locales } from "@/i18n/config";
import { upsertAuthProvider, upsertSchema } from "@/server/services/settings/auth-providers";

export type SettingsActionState = { ok: true } | { ok: false; error: string } | null;

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function bool(formData: FormData, key: string): boolean {
  const v = str(formData, key).toLowerCase();
  return v === "true" || v === "on" || v === "1";
}

function optional(value: string): string | null {
  return value.length > 0 ? value : null;
}

export async function upsertAuthProviderAction(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const user = await requirePermission("admin.settings.write");
  const parsed = upsertSchema.safeParse({
    key: str(formData, "key"),
    type: str(formData, "type"),
    displayName: str(formData, "displayName"),
    enabled: bool(formData, "enabled"),
    issuer: optional(str(formData, "issuer")),
    clientId: optional(str(formData, "clientId")),
    // Empty secret → keep the stored one (the service only overwrites when set).
    clientSecret: optional(str(formData, "clientSecret")),
    scopes: optional(str(formData, "scopes")),
    pkce: bool(formData, "pkce"),
    authorizationUrl: optional(str(formData, "authorizationUrl")),
    tokenUrl: optional(str(formData, "tokenUrl")),
    userInfoUrl: optional(str(formData, "userInfoUrl")),
    mapName: optional(str(formData, "mapName")),
    mapEmail: optional(str(formData, "mapEmail")),
  });
  if (!parsed.success) return { ok: false, error: "INVALID" };
  try {
    await upsertAuthProvider(parsed.data, { id: user.id });
  } catch {
    return { ok: false, error: "FAILED" };
  }
  return { ok: true };
}

export async function upsertSmtpAction(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const user = await requirePermission("admin.settings.write");
  const parsed = smtpSchema.safeParse({
    host: str(formData, "host"),
    port: str(formData, "port"),
    secure: bool(formData, "secure"),
    username: str(formData, "username"),
    password: str(formData, "password"),
    fromAddress: str(formData, "fromAddress"),
    fromName: optional(str(formData, "fromName")),
    enabled: bool(formData, "enabled"),
  });
  if (!parsed.success) return { ok: false, error: "INVALID" };
  try {
    await upsertSmtp(parsed.data, { id: user.id });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof SmtpPasswordRequiredError ? "PASSWORD_REQUIRED" : "FAILED",
    };
  }
  return { ok: true };
}

export type SmtpTestState =
  | { ok: true; to: string }
  | { ok: false; error: "NOT_CONFIGURED" | "RATE_LIMITED" }
  | { ok: false; error: "FAILED"; reason: SmtpFailure }
  | null;

export async function sendSmtpTestAction(
  _prev: SmtpTestState,
  formData: FormData,
): Promise<SmtpTestState> {
  const user = await requirePermission("admin.settings.write");
  if (!smtpTestLimiter.consume(user.id).allowed) return { ok: false, error: "RATE_LIMITED" };
  const raw = str(formData, "locale");
  const locale = hasLocale(locales, raw) ? raw : defaultLocale;
  const t = await getTranslations({ locale, namespace: "admin.smtp.testMail" });
  const appName = await getAppName();
  const res = await sendSmtpTest(
    { to: user.email, subject: t("subject", { appName }), text: t("body", { appName }) },
    { id: user.id },
  );
  if (res.ok) return { ok: true, to: user.email };
  if (res.error === "NOT_CONFIGURED") return { ok: false, error: "NOT_CONFIGURED" };
  return { ok: false, error: "FAILED", reason: res.reason };
}

export async function deleteSmtpConfigAction(): Promise<SettingsActionState> {
  const user = await requirePermission("admin.settings.write");
  try {
    await deleteSmtpConfig({ id: user.id });
  } catch {
    return { ok: false, error: "FAILED" };
  }
  return { ok: true };
}

// Coerce a known app-setting key's raw form value to its stored type.
function coerceAppSetting(key: string, raw: string): unknown | undefined {
  switch (key) {
    case "registration_mode":
      return ["OPEN", "INVITE_ONLY", "DISABLED"].includes(raw) ? raw : undefined;
    case "credentials_enabled":
    case "security.admin_2fa_required":
      return raw.toLowerCase() === "true" || raw.toLowerCase() === "on" || raw === "1";
    case "min_password_length": {
      const n = Number(raw);
      return Number.isInteger(n) && n >= 8 && n <= 128 ? n : undefined;
    }
    case "app_name":
      return raw.length > 0 ? raw : undefined;
    default:
      return undefined;
  }
}

const SETTING_FIELD = "s:";

// Saves every `s:<key>` field of one settings card; nothing is written if one is invalid.
export async function setAppSettingsAction(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const user = await requirePermission("admin.settings.write");
  const values: [string, unknown][] = [];
  for (const [field, raw] of formData.entries()) {
    if (!field.startsWith(SETTING_FIELD)) continue;
    if (typeof raw !== "string") return { ok: false, error: "INVALID" };
    const key = field.slice(SETTING_FIELD.length);
    const value = coerceAppSetting(key, raw.trim());
    if (value === undefined) return { ok: false, error: "INVALID" };
    values.push([key, value]);
  }
  try {
    await appSettings.setMany(values, user.id);
  } catch {
    return { ok: false, error: "FAILED" };
  }
  return { ok: true };
}
