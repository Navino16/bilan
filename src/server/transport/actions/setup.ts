"use server";

import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
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

// GET an https URL with the TCP connection PINNED to a pre-verified IP (no
// second DNS resolution → defeats DNS-rebinding TOCTOU), while keeping SNI /
// cert validation against the real hostname. Redirects are not followed and the
// body is size-capped.
function getPinned(
  url: URL,
  host: string,
  ip: string,
  family: number,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: "GET",
        servername: host,
        // Node may call lookup with { all: true } (autoSelectFamily) expecting an
        // array, or in single mode expecting (address, family). Support both.
        lookup: (_hostname, opts, cb) =>
          (opts as { all?: boolean })?.all
            ? (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [
                { address: ip, family },
              ])
            : cb(null, ip, family),
        timeout: 5000,
        headers: { Host: host, Accept: "application/json" },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          res.resume();
          resolve({ status, body: "" });
          return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => {
          body += c;
          if (body.length > 1_000_000) req.destroy(new Error("body too large"));
        });
        res.on("end", () => resolve({ status, body }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

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

  // Resolve the hostname and reject if ANY address is internal, then pin the
  // request to the verified address so undici/Node can't re-resolve to a
  // different (internal) IP between the check and the connection.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let pinned: { address: string; family: number };
  try {
    const addrs = await lookup(host, { all: true });
    if (addrs.length === 0) return { ok: false, error: "UNREACHABLE" };
    if (addrs.some((a) => isUnsafeIp(a.address))) return { ok: false, error: "UNSAFE_HOST" };
    pinned = { address: addrs[0].address, family: addrs[0].family };
  } catch {
    return { ok: false, error: "UNREACHABLE" };
  }

  try {
    const res = await getPinned(url, host, pinned.address, pinned.family);
    if (res.status < 200 || res.status >= 300) return { ok: false, error: "UNREACHABLE" };
    const doc = JSON.parse(res.body) as Record<string, unknown>;
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
    if (!r.success || !r.data.password) return { ok: false, error: "INVALID_SMTP" };
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
