"use server";

import { lookup } from "node:dns/promises";
import { z } from "zod";
import { completeSetup } from "@/server/services/bootstrap";
import { isSetupNeeded } from "@/server/services/setup-status";
import { appSettings } from "@/server/services/settings/app-settings";
import { upsertSmtp, smtpSchema } from "@/server/services/settings/smtp";
import { upsertAuthProvider, upsertSchema } from "@/server/services/settings/auth-providers";
import { getCurrentUser, hasPermission } from "@/server/auth/permissions";

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

// Block loopback / link-local / private / metadata ranges to limit SSRF from
// the test-connection fetch.
function isUnsafeIp(ip: string): boolean {
  const h = ip.toLowerCase();
  return (
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h) || // link-local incl. cloud metadata 169.254.169.254
    h === "0.0.0.0" ||
    h === "::" ||
    h === "::1" ||
    /^f[cd]/.test(h) || // fc00::/7 unique-local
    /^fe[89ab]/.test(h) // fe80::/10 link-local
  );
}

function isUnsafeHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  return h === "localhost" || h.endsWith(".localhost") || isUnsafeIp(h);
}

export type OidcTestResult =
  | { ok: true; authorizationEndpoint: string; tokenEndpoint: string; userinfoEndpoint?: string }
  | { ok: false; error: string };

// Probes an OIDC issuer's discovery document so the admin can validate the SSO
// config before saving. Read-only; stores nothing. Authorized for the first-run
// installer (setup not yet done) or an authenticated admin afterwards.
export async function testOidcConnectionAction(issuerInput: string): Promise<OidcTestResult> {
  if (!(await isSetupNeeded())) {
    const user = await getCurrentUser();
    if (!user || !(await hasPermission(user.id, "admin.settings.write"))) {
      return { ok: false, error: "UNAUTHORIZED" };
    }
  }

  const issuer = (issuerInput ?? "").trim();
  if (!issuer) return { ok: false, error: "NO_ISSUER" };

  let url: URL;
  try {
    url = new URL(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
  } catch {
    return { ok: false, error: "INVALID_URL" };
  }
  if (url.protocol !== "https:") return { ok: false, error: "HTTPS_REQUIRED" };
  if (isUnsafeHost(url.hostname)) return { ok: false, error: "UNSAFE_HOST" };

  // Resolve the hostname and reject if ANY address is internal — defeats a
  // public hostname that points at an internal/metadata IP.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  try {
    const addrs = await lookup(host, { all: true });
    if (addrs.some((a) => isUnsafeIp(a.address))) return { ok: false, error: "UNSAFE_HOST" };
  } catch {
    return { ok: false, error: "UNREACHABLE" };
  }

  try {
    // redirect: "manual" — a discovery document is served directly; refusing to
    // follow redirects stops a public issuer from bouncing us to an internal host.
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, error: "UNREACHABLE" };
    const doc = (await res.json()) as Record<string, unknown>;
    const authorizationEndpoint = doc.authorization_endpoint;
    const tokenEndpoint = doc.token_endpoint;
    if (typeof authorizationEndpoint !== "string" || typeof tokenEndpoint !== "string") {
      return { ok: false, error: "INVALID_DISCOVERY" };
    }
    return {
      ok: true,
      authorizationEndpoint,
      tokenEndpoint,
      userinfoEndpoint:
        typeof doc.userinfo_endpoint === "string" ? doc.userinfo_endpoint : undefined,
    };
  } catch {
    return { ok: false, error: "UNREACHABLE" };
  }
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
      pkce: str(formData, "oidc_pkce") === "true",
      authorizationUrl: str(formData, "oidc_authorizationUrl") || undefined,
      tokenUrl: str(formData, "oidc_tokenUrl") || undefined,
      userInfoUrl: str(formData, "oidc_userInfoUrl") || undefined,
      mapName: str(formData, "oidc_mapName") || undefined,
      mapEmail: str(formData, "oidc_mapEmail") || undefined,
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
