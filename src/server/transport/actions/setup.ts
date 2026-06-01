"use server";

import { z } from "zod";
import { completeSetup } from "@/server/services/bootstrap";
import { isSetupNeeded } from "@/server/services/setup-status";
import { appSettings } from "@/server/services/settings/app-settings";
import { upsertSmtp, smtpSchema } from "@/server/services/settings/smtp";
import { upsertAuthProvider, upsertSchema } from "@/server/services/settings/auth-providers";

export type ActionState = { ok: true } | { ok: false; error: string } | null;

const setupSchema = z.object({
  name: z.string().min(1),
  email: z.email(),
  password: z.string().min(12),
  locale: z.enum(["fr", "en"]).default("fr"),
  mode: z.enum(["OPEN", "INVITE_ONLY", "DISABLED"]),
});

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

// Atomic first-run setup: creates the first user (→ SUPER_ADMIN, signed in),
// sets the registration mode, and OPTIONALLY persists SMTP + an OIDC provider —
// all in one shot, gated by isSetupNeeded(). That single gate authorizes every
// privileged write here (no separate, unauthenticated action). Data is
// collected client-side across the wizard steps; SMTP/OIDC are applied only if
// the user filled them in (host / issuer present).
export async function completeSetupAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = setupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "INVALID" };

  // Validate optional SMTP up front so we can surface a precise error.
  let smtp: z.infer<typeof smtpSchema> | null = null;
  if (str(formData, "smtp_host")) {
    const r = smtpSchema.safeParse({
      host: str(formData, "smtp_host"),
      port: str(formData, "smtp_port"),
      secure: str(formData, "smtp_secure") === "true",
      username: str(formData, "smtp_username"),
      password: str(formData, "smtp_password"),
      fromAddress: str(formData, "smtp_fromAddress"),
      fromName: str(formData, "smtp_fromName") || null,
      enabled: true,
    });
    if (!r.success) return { ok: false, error: "INVALID_SMTP" };
    smtp = r.data;
  }

  // Validate optional OIDC up front.
  let oidc: z.infer<typeof upsertSchema> | null = null;
  if (str(formData, "oidc_issuer")) {
    const r = upsertSchema.safeParse({
      key: "oidc",
      type: "oidc",
      displayName: str(formData, "oidc_displayName") || "OIDC",
      enabled: true,
      issuer: str(formData, "oidc_issuer"),
      clientId: str(formData, "oidc_clientId"),
      clientSecret: str(formData, "oidc_clientSecret"),
      scopes: str(formData, "oidc_scopes") || null,
    });
    if (!r.success) return { ok: false, error: "INVALID_OIDC" };
    oidc = r.data;
  }

  if (!(await isSetupNeeded())) return { ok: false, error: "ALREADY_SETUP" };

  try {
    const { userId } = await completeSetup({
      name: parsed.data.name,
      email: parsed.data.email,
      password: parsed.data.password,
      locale: parsed.data.locale,
    });
    await appSettings.set("registration_mode", parsed.data.mode, userId);
    if (smtp) await upsertSmtp(smtp, { id: userId });
    if (oidc) await upsertAuthProvider(oidc, { id: userId });
    return { ok: true };
  } catch {
    return { ok: false, error: "FAILED" };
  }
}
