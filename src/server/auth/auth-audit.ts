import {
  createAuthMiddleware,
  getOAuthState,
  getSessionFromCtx,
  isAPIError,
} from "better-auth/api";
import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import { requestOrigin } from "@/server/http/client-ip";
import {
  notifySecurityEvent,
  type SecurityEvent,
} from "@/server/services/mail/security-notifications";

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

const LINK_CALLBACKS = new Set(["/callback/:id", "/oauth2/callback/:providerId"]);

// A Settings > Security link callback (#204) that redirects with `?error=`. Not audited: an OIDC
// IdP refusal, which generic-oauth redirects before parsing the state that identifies the user.
export async function auditLinkFailure(ctx: HookContext): Promise<void> {
  if (!LINK_CALLBACKS.has(ctx.path)) return;
  try {
    const link = (await getOAuthState())?.link;
    const location = ctx.context.responseHeaders?.get("location");
    if (!link || !location) return;
    const error = new URL(location, "http://callback.invalid").searchParams.get("error");
    if (!error) return;
    const params = (ctx.params ?? {}) as { id?: string; providerId?: string };
    await logEvent({
      userId: link.userId,
      action: "auth.identity.link_failed",
      metadata: { providerId: params.id ?? params.providerId ?? null, error: error.slice(0, 64) },
    });
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
      await db.verification.deleteMany({
        where: { value: event.userId, identifier: { startsWith: "trust-device-" } },
      });
    }
    const notified = NOTIFIED_EVENTS.get(event.action);
    if (notified && event.userId) {
      void notifySecurityEvent(notified, {
        userId: event.userId,
        at: new Date(),
        origin: requestOrigin(ctx.headers),
      });
    }
  } catch {
    // best-effort: an audit failure must not fail the auth request
  }
}

export type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

export async function pendingTwoFactor(ctx: HookContext) {
  const cookie = ctx.context.createAuthCookie("two_factor");
  const id = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  if (!id) return null;
  const verification = await ctx.context.internalAdapter.findVerificationValue(id);
  return verification ? { id, userId: verification.value } : null;
}
