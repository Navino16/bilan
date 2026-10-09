"use server";

import { getTranslations } from "next-intl/server";
import { hasLocale } from "next-intl";
import { hasPermission, requirePermission } from "@/server/auth/permissions";
import { smtpTestLimiter } from "@/server/auth/rate-limit";
import {
  appSettings,
  getAppName,
  SECURITY_SETTING_KEYS,
} from "@/server/services/settings/app-settings";
import {
  deleteSmtpConfig,
  sendSmtpTest,
  SmtpPasswordRequiredError,
  upsertSmtp,
  smtpSchema,
  type SmtpFailure,
} from "@/server/services/settings/smtp";
import { defaultLocale, locales } from "@/i18n/config";
import {
  AuthProviderError,
  createAuthProvider,
  deleteAuthProvider,
  providerSchema,
  updateAuthProvider,
} from "@/server/services/settings/auth-providers";
import { invalidInput, type FormFailure } from "@/lib/validation/field-errors";
import { MIN_PASSWORD_LENGTH_RANGE } from "@/lib/validation/app-settings";

export type SettingsActionState = { ok: true } | FormFailure | null;

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

export async function saveAuthProviderAction(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const user = await requirePermission("admin.security.write");
  const mode = str(formData, "mode");
  if (mode !== "create" && mode !== "update") return { ok: false, error: "INVALID" };
  const parsed = providerSchema.safeParse({
    key: str(formData, "key"),
    type: str(formData, "type"),
    displayName: str(formData, "displayName"),
    enabled: bool(formData, "enabled"),
    issuer: optional(str(formData, "issuer")),
    clientId: optional(str(formData, "clientId")),
    clientSecret: optional(str(formData, "clientSecret")),
    scopes: optional(str(formData, "scopes")),
    pkce: bool(formData, "pkce"),
    authorizationUrl: optional(str(formData, "authorizationUrl")),
    tokenUrl: optional(str(formData, "tokenUrl")),
    userInfoUrl: optional(str(formData, "userInfoUrl")),
    mapName: optional(str(formData, "mapName")),
    mapEmail: optional(str(formData, "mapEmail")),
    allowSignUp: bool(formData, "allowSignUp"),
  });
  if (!parsed.success) return invalidInput(parsed.error, Object.fromEntries(formData));
  try {
    const save = mode === "create" ? createAuthProvider : updateAuthProvider;
    await save(parsed.data, { id: user.id });
  } catch (e) {
    return { ok: false, error: e instanceof AuthProviderError ? e.code : "FAILED" };
  }
  return { ok: true };
}

export type DeleteProviderState = { ok: true } | { ok: false; error: string; count?: number };

export async function deleteAuthProviderAction(key: unknown): Promise<DeleteProviderState> {
  const user = await requirePermission("admin.security.write");
  if (typeof key !== "string" || !key.trim()) return { ok: false, error: "INVALID" };
  try {
    await deleteAuthProvider(key.trim(), { id: user.id });
  } catch (e) {
    if (e instanceof AuthProviderError) return { ok: false, error: e.code, count: e.count };
    return { ok: false, error: "FAILED" };
  }
  return { ok: true };
}

export async function upsertSmtpAction(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const user = await requirePermission("admin.security.write");
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
  if (!parsed.success) return invalidInput(parsed.error, Object.fromEntries(formData));
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
  const user = await requirePermission("admin.security.write");
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
  const user = await requirePermission("admin.security.write");
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
      const { min, max } = MIN_PASSWORD_LENGTH_RANGE;
      return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
    }
    case "app_name":
      return raw.length > 0 ? raw : undefined;
    default:
      return undefined;
  }
}

const SETTING_FIELD = "s:";

const INVALID_CODE: Record<string, string> = { min_password_length: "OUT_OF_RANGE" };

// Saves every `s:<key>` field of one settings card; nothing is written if one is invalid.
export async function setAppSettingsAction(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const user = await requirePermission("admin.settings.write");
  const values: [string, unknown][] = [];
  const fieldErrors: Record<string, string> = {};
  for (const [field, raw] of formData.entries()) {
    if (!field.startsWith(SETTING_FIELD)) continue;
    if (typeof raw !== "string") return { ok: false, error: "INVALID" };
    const key = field.slice(SETTING_FIELD.length);
    const value = coerceAppSetting(key, raw.trim());
    if (value === undefined)
      fieldErrors[field] = raw.trim() ? (INVALID_CODE[key] ?? "INVALID") : "REQUIRED";
    else values.push([key, value]);
  }
  if (Object.keys(fieldErrors).length) return { ok: false, error: "INVALID", fieldErrors };
  if (
    values.some(([key]) => SECURITY_SETTING_KEYS.has(key)) &&
    !(await hasPermission(user.id, "admin.security.write"))
  ) {
    return { ok: false, error: "FORBIDDEN" };
  }
  try {
    await appSettings.setMany(values, user.id);
  } catch {
    return { ok: false, error: "FAILED" };
  }
  return { ok: true };
}
