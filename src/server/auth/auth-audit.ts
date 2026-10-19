import {
  createAuthMiddleware,
  getOAuthState,
  getSessionFromCtx,
  isAPIError,
} from "better-auth/api";
import { purgeTrustedDevices } from "@/server/services/users/trusted-devices";
import { logEvent } from "@/server/services/audit";
import { requestOrigin } from "@/server/http/client-ip";
import { requestLocaleHint } from "@/server/http/request-locale";
import { syncPreferredLocale } from "@/server/services/users/preferences";
import {
  notifySecurityEvent,
  type SecurityEvent,
  type SignInMethod,
} from "@/server/services/mail/security-notifications";
import { providerCache } from "./providers";
import { auditedSsoError } from "@/lib/sso-errors";

type AuditInput = Parameters<typeof logEvent>[0];

export type AuditContext = {
  sessionUserId: () => Promise<string | null>;
  // Owner of the pending sign-in (two_factor cookie), before any session exists.
  pendingUserId: () => Promise<string | null>;
  // Better Auth rotates the session when a TOTP verification really enables 2FA.
  sessionRotated: boolean;
};

export async function authAuditEvent(
  path: string,
  returned: unknown,
  body: unknown,
  { sessionUserId, pendingUserId, sessionRotated }: AuditContext,
): Promise<AuditInput | null> {
  const failed = isAPIError(returned);
  switch (path) {
    case "/passkey/verify-registration": {
      if (failed) return null;
      const pk = returned as { id: string; userId: string };
      return {
        userId: pk.userId,
        action: "auth.passkey.added",
        entity: "Passkey",
        entityId: pk.id,
      };
    }
    case "/passkey/delete-passkey": {
      if (failed) return null;
      return {
        userId: await sessionUserId(),
        action: "auth.passkey.deleted",
        entity: "Passkey",
        entityId: (body as { id: string }).id,
      };
    }
    case "/passkey/verify-authentication": {
      if (failed) {
        return {
          action: "auth.login.failed",
          metadata: { method: "passkey", reason: returned.body?.code ?? null },
        };
      }
      const { user } = returned as { user: { id: string; email: string } };
      return {
        userId: user.id,
        action: "auth.login.success",
        metadata: { method: "passkey", email: user.email },
      };
    }
    case "/sign-in/email": {
      const email = String((body as { email?: unknown } | null)?.email ?? "")
        .trim()
        .toLowerCase();
      if (failed) {
        return {
          action: "auth.login.failed",
          metadata: { method: "password", email, reason: returned.body?.code ?? null },
        };
      }
      if ((returned as { twoFactorRedirect?: boolean }).twoFactorRedirect) {
        return { action: "auth.login.2fa_pending", metadata: { email } };
      }
      const { user } = returned as { user: { id: string; email: string } };
      return {
        userId: user.id,
        action: "auth.login.success",
        metadata: { method: "password", email: user.email },
      };
    }
    case "/two-factor/verify-totp":
    case "/two-factor/verify-backup-code": {
      const method = path.endsWith("totp") ? "totp" : "backup_code";
      // Without a session this is the second sign-in step; with one, the user is
      // confirming enrolment from the Security page.
      const userId = await sessionUserId();
      if (failed) {
        if (userId) return null;
        const pending = await pendingUserId();
        if (!pending) return null;
        return {
          userId: pending,
          action: "auth.login.failed",
          metadata: { method, reason: returned.body?.code ?? null },
        };
      }
      const { user } = returned as { user: { id: string; email: string } };
      if (userId) {
        return method === "totp" && sessionRotated ? { userId, action: "auth.2fa.enabled" } : null;
      }
      return {
        userId: user.id,
        action: "auth.login.success",
        metadata: { method, email: user.email },
      };
    }
    case "/two-factor/disable": {
      if (failed) return null;
      return { userId: await sessionUserId(), action: "auth.2fa.disabled" };
    }
    default:
      return null;
  }
}

// The Google and generic OIDC callback: account links and SSO sign-ins.
const SSO_CALLBACK = "/callback/:id";

export type SsoCallback = {
  providerId: string | null;
  user: { id: string; email: string } | null;
  signedUp: boolean;
  // Null until Better Auth has read it.
  state: { link?: { userId: string } } | null;
  error: string | null;
};

// A first SSO sign-in is audited as the sign-up alone, like a password sign-up (#258).
// Failures before the state is read (forged or expired callbacks, generic-oauth IdP refusals)
// can't be told from a link, so they aren't audited. A sign-in cancelled at the IdP isn't a failure.
export function ssoCallbackEvent(cb: SsoCallback): AuditInput | null {
  const { providerId, user } = cb;
  if (user) {
    return {
      userId: user.id,
      action: cb.signedUp ? "auth.register.success" : "auth.login.success",
      metadata: { method: "sso", providerId, email: user.email },
    };
  }
  if (!cb.state || !cb.error) return null;
  const error = auditedSsoError(cb.error);
  if (cb.state.link) {
    return {
      userId: cb.state.link.userId,
      action: "auth.identity.link_failed",
      metadata: { providerId, error },
    };
  }
  if (error === "access_denied") return null;
  return { action: "auth.login.failed", metadata: { method: "sso", providerId, reason: error } };
}

// The user.create hook and the callback's after-hooks share the endpoint's `ctx.context`.
const ssoSignUps = new WeakSet<object>();

export function markSsoSignUp(ctx: { context: object }): void {
  ssoSignUps.add(ctx.context);
}

function redirectError(ctx: HookContext): string | null {
  const location = ctx.context.responseHeaders?.get("location");
  if (!location) return null;
  return new URL(location, "http://callback.invalid").searchParams.get("error");
}

export async function auditSsoCallback(ctx: HookContext): Promise<void> {
  if (ctx.path !== SSO_CALLBACK) return;
  try {
    const params = (ctx.params ?? {}) as { id?: string };
    // Only a configured provider's key reaches the audit log: the path segment is caller-chosen.
    const provider = await providerCache
      .get()
      .then((rows) => rows.find((p) => p.key === params.id))
      .catch(() => undefined);
    const user = ctx.context.newSession?.user ?? null;
    const event = ssoCallbackEvent({
      providerId: provider?.key ?? null,
      user,
      signedUp: ssoSignUps.has(ctx.context),
      state: user ? null : await getOAuthState(),
      error: user ? null : redirectError(ctx),
    });
    if (user) await syncSignInLocale(user.id, ctx.headers);
    if (!event) return;
    await logEvent(event).catch((e) => console.error("[bilan] SSO sign-in audit failed", e));
    if (event.action === "auth.login.success" && event.userId) {
      void notifySecurityEvent("new_login", {
        userId: event.userId,
        at: new Date(),
        origin: requestOrigin(ctx.headers),
        pageLocale: requestLocaleHint(ctx.headers),
        method: { kind: "sso", provider: provider?.displayName ?? "SSO" },
      });
    }
  } catch {
    // best-effort: an audit failure must not fail the auth request
  }
}

const NOTIFIED_EVENTS = new Map<string, SecurityEvent>([
  ["auth.login.success", "new_login"],
  ["auth.passkey.added", "passkey_added"],
  ["auth.2fa.disabled", "two_factor_disabled"],
]);

// Sign-ins and passkey / two-factor endpoints can be reached without our Server
// Actions (browser or direct API calls), so they are audited from the after-hook.
export async function auditAuthRequest(ctx: HookContext): Promise<void> {
  try {
    const event = await authAuditEvent(ctx.path, ctx.context.returned, ctx.body, {
      sessionUserId: async () => (await getSessionFromCtx(ctx))?.user.id ?? null,
      pendingUserId: async () => (await pendingTwoFactor(ctx))?.userId ?? null,
      sessionRotated: Boolean(ctx.context.newSession),
    });
    if (!event) return;
    await logEvent(event);
    if (
      event.userId &&
      (event.action === "auth.2fa.enabled" || event.action === "auth.2fa.disabled")
    ) {
      await purgeTrustedDevices(event.userId);
    }
    if (event.action === "auth.login.success" && event.userId) {
      await syncSignInLocale(event.userId, ctx.headers);
    }
    const notified = NOTIFIED_EVENTS.get(event.action);
    if (notified && event.userId) {
      const method = event.metadata?.method as Exclude<SignInMethod["kind"], "sso"> | undefined;
      void notifySecurityEvent(notified, {
        userId: event.userId,
        at: new Date(),
        origin: requestOrigin(ctx.headers),
        pageLocale: requestLocaleHint(ctx.headers),
        ...(method ? { method: { kind: method } } : {}),
      });
    }
  } catch {
    // best-effort: an audit failure must not fail the auth request
  }
}

// Spec §3.4: a sign-in stores its page's locale, the language of the user's e-mails.
// Runs before the new-sign-in mail is sent, so that mail follows it.
async function syncSignInLocale(userId: string, headers: Headers | undefined): Promise<void> {
  const locale = requestLocaleHint(headers);
  if (locale) await syncPreferredLocale(userId, locale).catch(() => {});
}

export type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

export async function pendingTwoFactor(ctx: HookContext) {
  const cookie = ctx.context.createAuthCookie("two_factor");
  const id = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  if (!id) return null;
  const verification = await ctx.context.internalAdapter.findVerificationValue(id);
  return verification ? { id, userId: verification.value } : null;
}
